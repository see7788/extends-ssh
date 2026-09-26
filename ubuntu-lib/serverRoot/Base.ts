import { writeFile } from "node:fs/promises";
import type { Plugin } from "vite";
import path from "node:path";
import store from "../store/index.ts";
import { nginx } from "../nginx/index.ts";
import { peerjs } from "../peerjs/index.ts";
import { pm2 } from "../pm2/index.ts";
import { sftp } from "../sftp/index.ts";
import { sshForward } from "../sshForward/index.ts";
import { stunServer } from "../stunServer/index.ts";

/**链式注册，必须确保链式消费者可以不按顺序调用，类内部要完成调用顺序的逻辑化 */
export default class {
  private define: {
    devPort: number;
    peerjs?: Awaited<ReturnType<typeof peerjs.current>> & { config: { iceServers: Array<{ urls: string }> } };
    nginx?: Awaited<ReturnType<typeof nginx.current>>;
  }
  private definePromise?: Promise<typeof this.define>;
  constructor(devPort: number) {
    this.define = { devPort}
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
      const forward = await sshForward.current(this.define.devPort);
      return async () => {
        try {
          await this.define.nginx?.close();
        } finally {
          await forward.close();
        }
      };
    };
    return this;
  }
  addSftp(): this {
    this.actions.sftp = async () => {
      await sftp.makeRemote({ port: this.define.devPort, localPath: this.locPath })
    };
    return this;
  }

  addPm2(input: Omit<Parameters<typeof pm2.makeRemote>[0], "port" | "cwd">): this {
    this.actions.pm2 = async () => {
      await pm2.makeRemote({ ...input, cwd: sftp.remotePath(this.define.devPort), port: this.define.devPort });
    };
    return this;
  }

  private getDefine(): Promise<typeof this.define> {
    if (!this.definePromise) {
      this.definePromise = (async () => {
        await this.actions.peerjs?.();
        if (this.actions.pm2 || this.actions.sshForward) {
          this.define.nginx = await nginx.current(this.define.devPort);
        }
        if (!this.define.nginx && this.actions.sftp) {
          this.define.nginx = await nginx.makeRemote(sftp.remotePath(this.define.devPort));
        }
        return this.define;
      })();
    }
    return this.definePromise;
  }

  private async getClientDefine(value: unknown): Promise<Record<string, unknown>> {
    const client = await Promise.resolve(value) as Record<string, unknown>;
    const remote = this.define.nginx;
    return remote
      ? { ...client, host: remote.host, port: remote.port, secure: remote.secure }
      : client;
  }

  private getServerDefine(): Record<string, unknown> {
    const { nginx: _nginx, ...define } = this.define;
    return define;
  }

  start(define: Record<"server" | "client", unknown>): Record<"server" | "client", Plugin> {
    const server = { define: define.server as Record<string, unknown> };
    return {
      server: {
        name: `server${this.define.devPort}`,
        enforce: "post",
        config: async () => {
          await this.getDefine();
          return {
            server: { port: this.define.devPort, strictPort: true },
            define: { ...this.getServerDefine(), ...server.define }
          };
        },
        configResolved: async ({ root }) => {
          store.setState(s => {
            s.serverRoot[this.define.devPort] = root
          });
          await writeFile(
            path.join(root, "vite-env.d.ts"),
            `\uFEFF/// <reference types="vite/client" />\r\ndeclare const define: ${JSON.stringify({ ...this.getServerDefine(), ...server.define }, null, 2)};\n\ntype GeneratedEnv = typeof define;\n\ninterface ImportMetaEnv extends GeneratedEnv {}\n`,
            "utf8",
          );
          const client = await this.getClientDefine(define.client);
          await writeFile(
            path.join(root, `vite-${this.define.devPort}.d.ts`),
            `\uFEFF/// <reference types="vite/client" />\r\ndeclare const define: ${JSON.stringify({ [this.define.devPort]: client }, null, 2)};\n\ntype GeneratedEnv = typeof define;\n\ninterface ImportMetaEnv extends GeneratedEnv {}\n`,
            "utf8",
          );
        },
        configureServer: async () => this.actions.sshForward?.(),
        closeBundle: async () => {
          await this.actions.sftp?.();
          await this.actions.pm2?.();
        },
      },
      client: {
        name: `client${this.define.devPort}`,
        config: async () => {
          await this.getDefine();
          const client = await this.getClientDefine(define.client);
          return {
            define: { [this.define.devPort]: client },
          };
        },
        configResolved: async () => {
          if (this.actions.sftp && !await sftp.hasRemote(this.define.devPort)) {
            await this.actions.sftp();
          }
          if (this.actions.pm2 && !await pm2.hasRemote(this.define.devPort)) {
            await this.actions.pm2();
          }
        }
      }
    }
  }
}
