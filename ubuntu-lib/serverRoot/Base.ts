import { writeFile } from "node:fs/promises";
import type { Plugin } from "vite";
import path from "node:path";
import { z } from "zod";
import store from "../store/index.ts";
import { nginx } from "../nginx/index.ts";
import { peerjs } from "../peerjs/index.ts";
import { pm2 } from "../pm2/index.ts";
import { sftp } from "../sftp/index.ts";
import { sshForward } from "../sshForward/index.ts";
import { stunServer } from "../stunServer/index.ts";

const reservedPorts = new Set([80, 443, 3_478, 9_000, 9_001, 54_321]);
const devPortValidator = z.number().int().min(1).max(65_535)
  .refine(port => !reservedPorts.has(port), "devPort 与固定服务端口冲突");

/**链式注册，必须确保链式消费者可以不按顺序调用，类内部要完成调用顺序的逻辑化 */
export default class {
  private define: { devPort: number; peerjs?: Awaited<ReturnType<typeof peerjs.current>> & { config: { iceServers: Array<{ urls: string }> } } }
  constructor(devPort: number) {
    this.define = { devPort: devPortValidator.parse(devPort) }
  }
  private readonly actions: { [k in "peerjs" | "sftp" | "pm2"]?: () => Promise<void> } & { "sshForward"?: () => Promise<() => Promise<void>> } = {};
  private get locPath() {
    const c = store.getState().serverRoot[this.define.devPort]
    if (!c) {
      throw Error("!this.locPath")
    }
    return c
  }

  addPeerjs(): this {
    this.actions.peerjs = async () => {
      const peer = await peerjs.current();
      const stun = await stunServer.current();
      this.define.peerjs = { ...peer, config: { iceServers: [{ urls: `stun:${stun.host}:${stun.port}` }] } };
    };
    return this;
  }

  addSshForward(): this {
    this.actions.sshForward = async () => {
      await sshForward.current(this.define.devPort);
      try {
        const remote = await nginx.current(this.define.devPort);
        return async () => {
          try {
            await remote.close();
          } finally {
            await sshForward.closeRemote(this.define.devPort);
          }
        };
      } catch (error) {
        await sshForward.closeRemote(this.define.devPort).catch(() => undefined);
        throw error;
      }
    };
    return this;
  }
  addSftp(): this {
    this.actions.sftp = async () => {
      await sftp.current({ port: this.define.devPort, localPath: this.locPath })
    };
    return this;
  }

  addPm2(input: Omit<Parameters<typeof pm2.current>[0], "port" | "cwd">): this {
    this.actions.pm2 = async () => {
      await pm2.current({ ...input, cwd: sftp.remotePath(this.define.devPort), port: this.define.devPort });
    };
    return this;
  }

  start(client: { define: Record<string, unknown> }): Record<'server' | "client", Plugin> {
    return {
      server: {
        name: `server${this.define.devPort}`,
        enforce: "post",
        config: async () => {
          await this.actions.peerjs?.();
          return {
            server: { port: this.define.devPort, strictPort: true },
            define: this.define
          };
        },
        configResolved: async ({ root }) => {
          store.setState(s => {
            s.serverRoot[this.define.devPort] = root
          });
          await writeFile(
            path.join(root, "vite-env.d.ts"),
            `\uFEFF/// <reference types="vite/client" />\r\ndeclare const define: ${JSON.stringify(this.define, null, 2)};\n\ntype GeneratedEnv = typeof define;\n\ninterface ImportMetaEnv extends GeneratedEnv {}\n`,
            "utf8",
          );
          await writeFile(
            path.join(root, `vite-${this.define.devPort}.d.ts`),
            `\uFEFF/// <reference types="vite/client" />\r\ndeclare const define: ${JSON.stringify({ [this.define.devPort]: client.define }, null, 2)};\n\ntype GeneratedEnv = typeof define;\n\ninterface ImportMetaEnv extends GeneratedEnv {}\n`,
            "utf8",
          );
        },
        configureServer: async () => this.actions.sshForward?.(),
        closeBundle: async () => {
          await this.actions.sftp?.();
          await this.actions.pm2?.();
          if (this.actions.pm2) await nginx.current(this.define.devPort);
          else if (this.actions.sftp) await nginx.current(sftp.remotePath(this.define.devPort));
        },
      },
      client: {
        name: `client${this.define.devPort}`,
        config: () => ({
          define: { [this.define.devPort]: client.define }
        }),
        configResolved: async () => {
          if (this.actions.sftp && !await sftp.hasRemote(this.define.devPort)) {
            await this.actions.sftp();
          }
          if (this.actions.pm2 && !await pm2.hasRemote(this.define.devPort)) {
            await this.actions.pm2();
          }
          if (this.actions.pm2) await nginx.current(this.define.devPort);
          else if (this.actions.sftp) await nginx.current(sftp.remotePath(this.define.devPort));
          this.actions.peerjs && await peerjs.current();
        }
      }
    }
  }
}
