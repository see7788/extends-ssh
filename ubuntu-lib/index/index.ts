import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import Base from "./Base.ts";
import store from "../store/index.ts";
class Index {
  consumerPlugin<T extends Record<string, any> & { devPort?: never }>(
    producerDevPort: number,
    consumerDefine: T = {} as T,
  ): Plugin {
    return {
      name: `consumerPlugin${producerDevPort}`,
      configResolved: async ({ root }) => {
        const producer = store.getState().serverRoot[producerDevPort];
        if (!producer?.define) {
          return;
        }
        const name = `declare${producerDevPort}`;
        const define = {
          ...consumerDefine,
          [name]: producer.define,
        };
        const declareDirectory = path.join(root, "src", "declare");
        await mkdir(declareDirectory, { recursive: true });
        const declaration = `export default ${JSON.stringify(
          define,
          null,
          2,
        )} as const;\n`;
        await writeFile(
          path.join(declareDirectory, `default.ts`),
          `\uFEFF${declaration.replace(/\r?\n/g, "\r\n")}`,
          "utf8",
        );
      },
    } satisfies Plugin;
  }
  producer(devPort: number) {
    return new Base({ devPort })
  }
  /**webrtc信令 */
  get producer9002() {
    return new Base({ devPort: 9002 }).pm2Add({ command: "pnpm dev" }).producerPlugin({})
  }
  get producer3005() {
    return new Base({ devPort: 3005 }).peerjsAdd().producerPlugin({})
  }
}

export default  new Index