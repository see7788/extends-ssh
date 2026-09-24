import type { Plugin } from "vite";
import { z } from "zod";
import { nginx } from "../nginx/index.ts";
import { peerjs } from "../peerjs/index.ts";
import { pm2 } from "../pm2/index.ts";
import { sftp } from "../sftp/index.ts";
import { sshForward } from "../sshForward/index.ts";
import { stunServer } from "../stunServer/index.ts";

// ServerBase 只编排基础能力，不承担远端资源契约。
type Pm2Input = Omit<Parameters<typeof pm2.current>[0], "port">;
type Define = {
  peerjs?: Awaited<ReturnType<typeof peerjs.current>>;
  stunServer?: Awaited<ReturnType<typeof stunServer.current>>;
};
const devPortValidator = z.number().int().min(1).max(65_535);

export class ServerBase {
  protected readonly devPort: z.infer<typeof devPortValidator>;
  readonly plugin: Plugin[] = [];
  readonly define: Define = {};
  private bundleNginxRoute: "port" | "path" | undefined;
  constructor(devPort: number) {
    this.devPort = devPortValidator.parse(devPort);
    this.plugin.push({
      name: "baseserver" + this.devPort + ":register",
      config: () => ({
        server: {
          port: this.devPort,
          strictPort: true,
        },
      }),
    });
  }

  // 远程应用进程：<ssh-host>:${devPort}（由应用命令监听）
  addPm2({ path, command, environment, addNginx = false }: Pm2Input & { addNginx?: boolean }): this {
    if (addNginx) {
      if (this.bundleNginxRoute === "path") {
        throw new Error("Nginx route conflict: addSftp and addPm2 cannot both enable addNginx");
      }
      this.bundleNginxRoute = "port";
    }
    this.plugin.push({
      name: "baseserver" + this.devPort + ":pm2",
      closeBundle: {
        order: "post",
        sequential: true,
        handler: async () => {
          await pm2.current({ path, command, environment, port: this.devPort });
          if (addNginx) await nginx.current(this.devPort);
        },
      },
    });
    return this;
  }

  // 远程文件路径：<remoteRoot>/<devPort>
  addSftp({ addNginx = false }: { addNginx?: boolean } = {}): this {
    if (addNginx) {
      if (this.bundleNginxRoute === "port") {
        throw new Error("Nginx route conflict: addPm2 and addSftp cannot both enable addNginx");
      }
      this.bundleNginxRoute = "path";
    }
    let projectPath: string | undefined;
    this.plugin.push({
      name: "baseserver" + this.devPort + ":sftp",
      configResolved: config => {
        projectPath = config.root;
      },
      closeBundle: {
        order: "pre",
        sequential: true,
        handler: async () => {
          if (projectPath === undefined) throw new Error("Vite 项目根目录尚未解析");
          await sftp.current({ port: this.devPort, localPath: projectPath });
          if (addNginx) {
            const remote = await sftp.getRemote(this.devPort);
            await nginx.current(remote.path);
          }
        },
      },
    });
    return this;
  }

  // SSH 端口转发：<ssh-host>:${devPort}
  addSshForward({ addNginx = false }: { addNginx?: boolean } = {}): this {
    this.plugin.push({
      name: "baseserver" + this.devPort + ":ssh-forward",
      configureServer: async () => {
        await sshForward.current(this.devPort);
        try {
          const nginxRemote = addNginx ? await nginx.current(this.devPort) : undefined;
          return async () => {
            await nginxRemote?.close();
            await sshForward.closeRemote(this.devPort);
          };
        } catch (error) {
          await sshForward.closeRemote(this.devPort);
          throw error;
        }
      },
    });
    return this;
  }

  // PeerJS 连接元数据
  addPeerjs(): this {
    this.plugin.push({
      name: "baseserver" + this.devPort + ":peerjs",
      config: async () => {
        const remote = await peerjs.current();
        this.define.peerjs = remote;
        return { define: this.define };
      },
    });
    return this;
  }

  // STUN 服务元数据
  addStunServer(): this {
    this.plugin.push({
      name: "baseserver" + this.devPort + ":stun-server",
      config: async () => {
        const remote = await stunServer.current();
        this.define.stunServer = remote;
        return { define: this.define };
      },
    });
    return this;
  }
}
