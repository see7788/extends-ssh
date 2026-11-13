import store from "../store.ts";
import merge from "lodash/merge.js";
import path from "node:path";
import { mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import type { Plugin } from "vite";
type Define_t = {
  [key: string]: any;
  ownerKey?: never;
};
export default class {
  devPort
  must_publicPort
  constructor(devPort: number, must_publicPort: boolean = false) {
    this.devPort=devPort;
    this.must_publicPort=must_publicPort
   }
  //端口占用检查,import.meta.filename||vite.configResolved.root
  ownerKeyProt(ownerKey: string) {
    store.setState(state => {
      if (this.must_publicPort) {
        if (!Number.isInteger(this.devPort) || this.devPort < 10000 || this.devPort > 20000) {
          throw new Error("服务器放行端口是10000-20000" + String(this.devPort));
        }
      }
      const c = state.ports[this.devPort]?.ownerKey
      if (c && c !== ownerKey) {
        throw new Error(`端口 ${this.devPort} 已被 ${c} 占用, 无法在 ${ownerKey} 使用`);
      }
      //      state.ports[this.devPort].ownerKey = ownerKey
    });
  }
  //收集
  mergeState(define: Define_t) {
    store.setState(state => {
      state.ports[this.devPort] = merge(
        {},
        state.ports[this.devPort],
        define,
      );
    });
  }
  //生成临时文件,并行常量注入
  writeFilePlugin(define: Define_t): Plugin {
    const k = `__declare__`
    return {
      name: `writeFilePlugin${this.devPort}`,
      enforce: "post",
      config: () => ({
        define: {
          [k]: JSON.stringify({
            ...store.getState().ports[this.devPort],
            ...define,
          }),
        },
      }),
      configResolved: async ({ configFile }) => {
        if (!configFile) {
          throw new Error(`configFile 为空`);
        }
        const root = path.dirname(configFile || "")
        const state = store.getState().ports[this.devPort];
        this.ownerKeyProt(root)
        store.setState(state => {
          state.ports[this.devPort] = merge(
            {},
            state.ports[this.devPort],
            define,
            { ownerKey: root }
          );
        });
        const declareDirectory = path.join(root, "src", "declare");
        await mkdir(declareDirectory, { recursive: true });
        await fsWriteFile(
          path.join(declareDirectory, `${k}.ts`),
          `export default ${JSON.stringify({ ...state, ...define }, null, 2)} as const;`,
          "utf8",
        );
        await fsWriteFile(
          path.join(declareDirectory, `${k}.d.ts`),
          `declare const  ${k}: ${JSON.stringify({ ...state, ...define }, null, 2)}`,
          "utf8",
        );
      }
    }
  }
}

