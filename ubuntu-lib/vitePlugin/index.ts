import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import Base from "./Base.ts";
import store from "../store/index.ts";
export default class {
  consumerPlugin<T extends Record<string, unknown> & { devPort?: never }>(
    producerDevPort: number,
    consumerDefine: T = {} as T,
  ): Plugin {
    return {
      name: `consumerPlugin${producerDevPort}`,
      configResolved: async ({ root }) => {
        const declareDirectory = path.join(root, "src", "declare");
        await mkdir(declareDirectory, { recursive: true });
        await writeFile(
          path.join(declareDirectory, `default.ts`),
          `export default ${JSON.stringify(
            { ...consumerDefine, ...store.getState().vitePlugin[producerDevPort].define },
            null,
            2,
          )} as const;`,
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
