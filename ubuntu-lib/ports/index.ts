import store from "../store.ts";
import merge from "lodash/merge";
import path from "node:path";
import { mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import type { Plugin } from "vite";
type Define_t = {
  [key: string]: any;
  ownerKey?: never;
};
export default class {
  constructor(private readonly devPort: number, private must_publicPort: boolean = true) { }
  //端口占用检查,import.meta.filename||vite.configResolved.root
  ownerKeyProt(ownerKey: string) {
    store.setState(state => {
      if (this.must_publicPort) {
        if (!Number.isInteger(this.devPort) || this.devPort < 10000 || this.devPort > 20000) {
          throw new Error("服务器放行端口是10000-20000" + String(this.devPort));
        }
      }
      const c = state.ports[this.devPort]
      if (c && c.ownerKey && c.ownerKey !== ownerKey) {
        throw new Error(`端口 ${this.devPort} 已被 ${c.ownerKey} 占用, 无法在 ${ownerKey} 使用`);
      }
      if (!c) {
        state.ports[this.devPort].ownerKey = ownerKey
      }
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
    return {
      name: `writeFilePlugin${this.devPort}`,
      enforce: "post",
      config: () => ({
        define: {
          __MY_DEFINE__: JSON.stringify({
            ...store.getState().ports[this.devPort],
            ...define,
          }),
        },
      }),
      configResolved: async ({ root }) => {
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
          path.join(declareDirectory, `declare.ts`),
          `export default ${JSON.stringify({ ...state, ...define }, null, 2)} as const;`,
          "utf8",
        );
      }
    }
  }
}