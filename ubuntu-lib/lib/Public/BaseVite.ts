import path from "node:path";
import type { Plugin } from "vite";
import { z } from "zod";
import { nginx } from "../Nginx/index.ts";
import { pm2 } from "../Pm2/index.ts";
import { sftp } from "../Sftp/index.ts";
import { sshForward } from "../SshForward/index.ts";

export const devPortValidator = z.number().int().min(1).max(9_999).brand<"DevPort">();

const projectPathValidator = z.string().trim().min(1).refine(
  path.isAbsolute,
  "projectPath 必须是绝对路径",
);

export default abstract class BaseVite {
  protected abstract readonly devPort: z.infer<typeof devPortValidator>;
  protected readonly projectPath: string;
  protected readonly processOptions?: Omit<Parameters<typeof pm2.makeRemote>[0], "port">;

  protected constructor(projectPath: string) {
    this.projectPath = path.normalize(projectPathValidator.parse(projectPath));
  }

  protected register(): Plugin {
    let buildPath: string | undefined;
    return {
      name: `extends-ssh:${this.constructor.name}:register:${this.devPort}`,
      config: this.setVitePort,
      configResolved: config => {
        if (config.command !== "build") return;
        if (path.normalize(config.root) !== this.projectPath) {
          throw new Error(`Vite project root 与 BaseVite.projectPath 不一致: ${config.root}`);
        }
        buildPath = path.resolve(config.root, config.build.outDir);
      },
      closeBundle: async () => {
        if (buildPath === undefined) {
          throw new Error("BaseVite.register 未取得 Vite build 输出目录");
        }
        await sftp.makeRemote({
          port: this.devPort,
          localPath: buildPath,
        });
      },
    };
  }

  protected consume(): Plugin {
    return {
      name: `extends-ssh:${this.constructor.name}:consume:${this.devPort}`,
      config: this.setVitePort,
      configResolved: async () => {
        if (!await sftp.hasRemote(this.devPort)) {
          throw new Error(`开发端口尚未分配 SFTP 远程目录: ${this.devPort}`);
        }
      },
    };
  }

  protected forward(): Plugin {
    let remote: Awaited<ReturnType<typeof sshForward.makeRemote>> | undefined;
    return {
      name: `extends-ssh:${this.constructor.name}:forward:${this.devPort}`,
      config: this.setVitePort,
      configureServer: async server => {
        remote = await sshForward.makeRemote(this.devPort);
        server.httpServer?.once("close", () => {
          const active = remote;
          remote = undefined;
          void active?.close();
        });
      },
    };
  }

  protected route(): Plugin {
    let command: "serve" | "build" | undefined;
    return {
      name: `extends-ssh:${this.constructor.name}:route:${this.devPort}`,
      config: this.setVitePort,
      configResolved: config => {
        command = config.command;
      },
      configureServer: async () => {
        if (command !== "serve") return;
        await nginx.makeRemote(this.devPort);
      },
      closeBundle: async () => {
        if (command !== "build") return;
        await nginx.makeRemote(this.devPort);
      },
    };
  }

  protected process(): Plugin {
    return {
      name: `extends-ssh:${this.constructor.name}:process:${this.devPort}`,
      config: this.setVitePort,
      closeBundle: async () => {
        if (this.processOptions === undefined) {
          throw new Error("BaseVite.processOptions 未由具体项目提供");
        }
        await pm2.makeRemote({
          ...this.processOptions,
          port: this.devPort,
        });
      },
    };
  }

  protected readonly setVitePort: Plugin["config"] = () => ({
    server: {
      port: this.devPort,
      strictPort: true,
    },
  });
}
