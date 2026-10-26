import { statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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

type state_t = {
  peerjs: {
    state: Required<Pick<PeerOptions, "host" | "port" | "path" | "secure" | "key">> & {
      readonly config: {
        readonly iceServers: Array<{ readonly urls: string }>;
      };
    };
    actions: {
      peerjs: () => Promise<() => Promise<void>>;
    };
  };
  sshForward: {
    state: { readonly host: string };
    actions: {
      sshForward: () => Promise<() => Promise<void>>;
    };
  };
  sftp: {
    state: { readonly host: string };
    actions: {
      sftp: () => Promise<() => Promise<void>>;
    };
  };
  pm2: {
    state: { readonly host: string };
    actions: {
      pm2: () => Promise<() => Promise<void>>;
    };
  };
};

export default class <T extends Partial<state_t> & { devPort: number }> {
  constructor(public state: T) { }

  private get locPath() {
    const c = store.getState().serverRoot[this.state.devPort]
    if (!c) {
      throw Error("!store.getState().serverRoot[this.state.devPort]")
    }
    if (!statSync(c.packagePath, { throwIfNoEntry: false })) {
      throw Error("!statSync(c.packagePath, { throwIfNoEntry: false })")
    }
    return c.packagePath
  }

  serviceDefine(): {
    [K in Exclude<keyof this["state"], "devPort"> as NonNullable<this["state"][K]> extends { state: unknown } ? K : never]:
    NonNullable<this["state"][K]> extends { state: infer State } ? State : never;
  } {
    return Object.fromEntries(
      Object.entries(this.state)
        .filter(([name]) => name !== "devPort")
        .map(([name, service]) => [
          name,
          typeof service === "object" && service !== null && "state" in service ? service.state : undefined,
        ])
        .filter(([, service]) => service !== undefined),
    ) as any;
  }
  peerjsAdd<Self extends this>(this: Self): Self & {
    state: Self["state"] & Pick<state_t, "peerjs">;
  } {
    const state = store.getState();
    this.state.peerjs = {
      state: {
        host: state.ssh.host,
        port: state.peerjs.listenPort,
        path: state.peerjs.pathname,
        secure: false,
        key: state.peerjs.key,
        config: {
          iceServers: [{ urls: `stun:${state.ssh.host}:${state.stunServer.port}` }],
        },
      },
      actions: {
        peerjs: async () => {
          await peerjs.remoteIsRunning();
          await stunServer.remoteIsRunning();
          return async () => { }
        },
      },
    };
    return this as any;
  }


  sshForwardAdd<Self extends this>(this: Self): Self & {
    state: Self["state"] & Pick<state_t, "sshForward">;
  } {
    const state = store.getState();
    this.state.sshForward = {
      state: {
        host: `${this.state.devPort}.${state.domain}`,
      },
      actions: {
        sshForward: async () => {
          const current = await sshForward.remoteIsRunning();
          if (!current) throw new Error("SSH 转发服务未返回生命周期方法");
          const forward = await current(this.state.devPort);
          return async () => {
            forward.close();
          };
        },
      },
    };
    return this as any;
  }

  sftpAdd<Self extends this>(this: Self): Self & {
    state: Self["state"] & Pick<state_t, "sftp">;
  } {
    const state = store.getState();
    this.state.sftp = {
      state: {
        host: `${this.state.devPort}.${state.domain}`,
      },
      actions: {
        sftp: async () => {
          await sftp.makeRemote({ port: this.state.devPort, localPath: this.locPath })
          return async () => { }
        },
      },
    };
    return this as any;
  }

  pm2Add<Self extends this>(
    this: Self,
    input: Omit<Parameters<typeof pm2.makeRemote>[0], "port" | "cwd">,
  ): Self & {
    state: Self["state"] & Pick<state_t, "pm2">;
  } {
    const state = store.getState();
    this.state.pm2 = {
      state: {
        host: `${this.state.devPort}.${state.domain}`,
      },
      actions: {
        pm2: async () => {
          const c = await pm2.makeRemote({
            ...input,
            cwd: sftp.remotePath(this.state.devPort),
            port: this.state.devPort,
          });
          return async () => c.close()
        },
      },
    };
    return this as any;
  }

  producerPlugin<Self extends this, T extends Record<string, any> & { devPort?: never }>(
    this: Self,
    producerDefine: T,
  ): Plugin {
    return {
      name: `producerPlugin${this.state.devPort}`,
      enforce: "post",
      config: async () => {
        return {
          server: { port: this.state.devPort, strictPort: true },
        };
      },
      configResolved: async ({ root }) => {
        store.setState(s => {
          s.serverRoot[this.state.devPort] = {
            packagePath: root,
            define:producerDefine,
          };
        });
        const declareDirectory = path.join(root, "src", "declare");
        await mkdir(declareDirectory, { recursive: true });
        await writeFile(
          path.join(declareDirectory, `default.ts`),
          `export default ${JSON.stringify(
            { ...this.serviceDefine(), ...producerDefine },
            null,
            2,
          )} as const;`,
          "utf8",
        );
      },
      configureServer: () => this.state.sshForward?.actions.sshForward?.(),
      closeBundle: async () => {
        await this.state.sftp?.actions.sftp?.();
        await this.state.pm2?.actions.pm2?.();
      },
    }
  }

}
