import { statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import store from "../store/index.ts";
import { nginx } from "../nginx/index.ts";
import { peerjs } from "../peerjs/index.ts";
import { pm2 } from "../pm2/index.ts";
import { sftp } from "../sftp/index.ts";
import { sshForward } from "../sshForward/index.ts";
import { stunServer } from "../stunServer/index.ts";
import type { PeerOptions } from "peerjs";
type defineState = {
  devPort: number;
  peerjs?: Required<Pick<PeerOptions, "host" | "port" | "path" | "secure" | "key">> & {
    readonly config: {
      readonly iceServers: Array<{ readonly urls: string }>;
    };
  };
  nginx?: Pick<Awaited<ReturnType<typeof nginx.current>>, "host">;
}
type replaceBase_t<instance, next extends Base<any>> =Omit<instance, keyof Base<any>> & next;

export class Base<D extends Pick<defineState, "devPort">> {

}
/**链式注册，必须确保链式消费者可以不按顺序调用，类内部要完成调用顺序的逻辑化 */
export default class <D extends defineState> extends Base<D> {

  constructor(op: D) {
    super()
    this.defineState = op
  }
  protected readonly actions: { [k in "peerjs" | "sftp" | "pm2" | "sshForward"]?: () => Promise<() => Promise<void>> } = {};
  protected defineState: D
  peerjsAdd() {
    const state = store.getState();
    this.defineState.peerjs = {
      host: state.ssh.host,
      port: state.peerjs.listenPort,
      path: state.peerjs.pathname,
      secure: false,
      key: state.peerjs.key,
      config: {
        iceServers: [{ urls: `stun:${state.ssh.host}:${state.stunServer.port}` }],
      },
    };
    this.actions.peerjs = async () => {
      await peerjs.current();
      await stunServer.current();
      return async () => { }
    };
    return this as Base<D & { peerjs: NonNullable<defineState["peerjs"]> }>;
  }
  private get locPath() {
    const c = store.getState().serverRoot[this.defineState.devPort]
    if (!c) {
      throw Error("!store.getState().serverRoot[this.devPort]")
    }
    if (!statSync(c.packagePath, { throwIfNoEntry: false })) {
      throw Error("!statSync(c.packagePath, { throwIfNoEntry: false })")
    }
    return c.packagePath
  }
  sshForwardAdd() {
    this.defineState.nginx ??= {
      host: `${this.defineState.devPort}.${store.getState().domain}`
    };
    this.actions.sshForward = async () => {
      const forward = await sshForward.current(this.defineState.devPort);
      return async () => {
        forward.close();
      };
    };
    return this as Base<D & { nginx: NonNullable<defineState["nginx"]> }>;
  }
  sftpAdd() {
    this.defineState.nginx ??= {
      host: `${this.defineState.devPort}.${store.getState().domain}`
    };
    this.actions.sftp = async () => {
      await sftp.makeRemote({ port: this.defineState.devPort, localPath: this.locPath })
      return async () => { }
    };
    return this as Base<D & { nginx: NonNullable<defineState["nginx"]> }>;
  }
  pm2Add(input: Omit<Parameters<typeof pm2.makeRemote>[0], "port" | "cwd">) {
    this.defineState.nginx ??= {
      host: `${this.defineState.devPort}.${store.getState().domain}`
    };
    this.actions.pm2 = async () => {
      const c = await pm2.makeRemote({ ...input, cwd: sftp.remotePath(this.defineState.devPort), port: this.defineState.devPort });
      return async () => c.close()
    };
    return this as Base<D & { nginx: NonNullable<defineState["nginx"]> }>;
  }
  producer<T extends Omit<Record<string, any>, "devPort">>(producerDefine: T) {
    const define: D & T = { ...this.defineState, ...producerDefine }
    return {
      producerPlugin: () => {
        return {
          name: `producerPlugin${this.defineState.devPort}`,
          enforce: "post",
          config: async () => {
            return {
              server: { port: this.defineState.devPort, strictPort: true },
              define
            };
          },
          configResolved: async ({ root }) => {
            store.setState(s => {
              s.serverRoot[this.defineState.devPort] = {
                packagePath: root,
                producerDefine,
              };
            });
            await writeFile(
              path.join(root, `declare.d.ts`),
              `declare const declare: ${JSON.stringify(
                define,
                null,
                2,
              )};\n`,
              "utf8",
            );
          },
          configureServer: () => this.actions.sshForward?.(),
          closeBundle: async () => {
            await this.actions.sftp?.();
            await this.actions.pm2?.();
          },
        } satisfies Plugin
      },
      consumerPlugin: (consumerDefine: (define: D & { [K in `declare${D["devPort"]}`]: T }) => Record<string, any>) => {
        const define = consumerDefine({
          ...this.defineState,
          [`declare${this.defineState.devPort}`]: producerDefine,
        } as D & { [K in `declare${D["devPort"]}`]: T })
        return {
          name: `consumerPlugin declare${this.defineState.devPort}`,
          config: async () => {
            return {
              define
            };
          },
          configResolved: async ({ root }) => {
            if (this.actions.sftp && !await sftp.hasRemote(this.defineState.devPort)) {
              await this.actions.sftp();
            }
            if (this.actions.pm2 && !await pm2.hasRemote(this.defineState.devPort)) {
              await this.actions.pm2();
            }
            await writeFile(
              path.join(root, `declare${this.defineState.devPort}.d.ts`),
              `declare const declare${this.defineState.devPort}: ${JSON.stringify(
                define,
                null,
                2,
              )};\n`,
              "utf8",
            );
          }
        } satisfies Plugin
      }
    }
  }

}
