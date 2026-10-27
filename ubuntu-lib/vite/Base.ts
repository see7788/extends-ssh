// import { statSync } from "node:fs";
// import { mkdir, writeFile } from "node:fs/promises";
// import path from "node:path";
// import type { Plugin } from "vite";
// import store from "../store/index.ts";
// import Peerjs from "../peerjs/index.ts";
// import Pm2 from "../pm2/index.ts";
// import Sftp from "../sftp/index.ts";
// import SshForward from "../sshForward/index.ts";
//
// type ProducerServices = {
//   peerjs: ReturnType<Peerjs["vite"]>;
//   sshForward: ReturnType<SshForward["vite"]>;
//   sftp: ReturnType<Sftp["vite"]>;
//   pm2: ReturnType<Pm2["vite"]>;
// };
// type ProducerState = Partial<ProducerServices> & { devPort: number };
//
// export default class <T extends ProducerState> {
//   constructor(public state: T) { }
//
//   private get locPath() {
//     const c = store.getState().vite[this.state.devPort]
//     if (!c) {
//       throw Error("!store.getState().vite[this.state.devPort]")
//     }
//     if (!statSync(c.packagePath, { throwIfNoEntry: false })) {
//       throw Error("!statSync(c.packagePath, { throwIfNoEntry: false })")
//     }
//     return c.packagePath
//   }
//
//   serviceDefine(): {
//     [K in Exclude<keyof T, "devPort"> as NonNullable<T[K]> extends { state: unknown } ? K : never]:
//     NonNullable<T[K]> extends { state: infer State } ? State : never;
//   } {
//     return Object.fromEntries(
//       Object.entries(this.state)
//         .filter(([name]) => name !== "devPort")
//         .map(([name, service]) => [
//           name,
//           typeof service === "object" && service !== null && "state" in service ? service.state : undefined,
//         ])
//         .filter(([, service]) => service !== undefined),
//     ) as any;
//   }
//   peerjsAdd<Self extends this>(this: Self): Self & {
//     state: Self["state"] & Pick<ProducerServices, "peerjs">;
//   } {
//     const peerjs = new Peerjs();
//     this.state.peerjs = peerjs.vite();
//     return this as any;
//   }
//
//   sshForwardAdd<Self extends this>(this: Self): Self & {
//     state: Self["state"] & Pick<ProducerServices, "sshForward">;
//   } {
//     const sshForward = new SshForward();
//     this.state.sshForward = sshForward.vite(this.state.devPort);
//     return this as any;
//   }
//
//   sftpAdd<Self extends this>(this: Self): Self & {
//     state: Self["state"] & Pick<ProducerServices, "sftp">;
//   } {
//     const sftp = new Sftp();
//     this.state.sftp = sftp.vite(this.state.devPort, this.locPath);
//     return this as any;
//   }
//
//   pm2Add<Self extends this>(
//     this: Self,
//     input: Omit<Parameters<Pm2["makeRemote"]>[0], "port" | "cwd">,
//   ): Self & {
//     state: Self["state"] & Pick<ProducerServices, "pm2">;
//   } {
//     const pm2 = new Pm2();
//     this.state.pm2 = pm2.vite(this.state.devPort, input);
//     return this as any;
//   }
//
//   producerPlugin<Self extends this, TDefine extends Record<string, unknown> & { devPort?: never }>(
//     this: Self,
//     producerDefine: TDefine,
//   ): Plugin {
//     return {
//       name: `producerPlugin${this.state.devPort}`,
//       enforce: "post",
//       config: async () => {
//         return {
//           server: { port: this.state.devPort, strictPort: true },
//         };
//       },
//       configResolved: async ({ root }) => {
//         store.setState(s => {
//           s.vite[this.state.devPort] = {
//             packagePath: root,
//             define:producerDefine,
//           };
//         });
//         const declareDirectory = path.join(root, "src", "declare");
//         await mkdir(declareDirectory, { recursive: true });
//         await writeFile(
//           path.join(declareDirectory, `default.ts`),
//           `export default ${JSON.stringify(
//             { ...this.serviceDefine(), ...producerDefine },
//             null,
//             2,
//           )} as const;`,
//           "utf8",
//         );
//       },
//       configureServer: () => this.state.sshForward?.actions(),
//       closeBundle: async () => {
//         await this.state.sftp?.actions();
//         await this.state.pm2?.actions();
//       },
//     }
//   }
//
// }
//