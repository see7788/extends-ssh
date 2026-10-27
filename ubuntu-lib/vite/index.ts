import { mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import store from "../store/index.ts";
import merge from "lodash/merge";
export default class {
  private async writeFile(root: string, port: number, define: Record<string, unknown>): Promise<void> {
    const declareDirectory = path.join(root, "src", "declare");
    await mkdir(declareDirectory, { recursive: true });
    await fsWriteFile(
      path.join(declareDirectory, `${port}.ts`),
      `export default ${JSON.stringify(define, null, 2)} as const;`,
      "utf8",
    );
  }

  mergeState(devPort: number, define: Record<string, unknown>) {
    store.setState(state => {
      state.vite[devPort] = merge(
        {},
        state.vite[devPort],
        define,
      );
    });
  }
  mergeStatePlugin(devPort: number, define: Record<string, unknown>): Plugin {
    return {
      name: `mergeStatePlugin${devPort}`,
      enforce: "pre",
      configResolved: async config => {
        this.mergeState(devPort, { ...define, devPort, packagePath: config.root })
      },
    }
  }

  getStatePlugin(devPort: number): Plugin {
    return {
      name: `getStatePlugin${devPort}`,
      enforce: "post",
      configResolved: async ({ root }) => {
        const define = store.getState().vite[devPort];
        if (define) {
          await this.writeFile(root, devPort, define);
        }
      },
    }
  }
}