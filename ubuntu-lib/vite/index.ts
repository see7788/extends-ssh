import { mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import store from "../store.ts";
import merge from "lodash/merge";
import { getViteState, listViteState } from "./state.ts";
export default class {
  constructor(private readonly devPort: number) { }

  mergeState(define: Record<string, unknown>) {
    store.setState(state => {
      state.vite[this.devPort] = merge(
        {},
        state.vite[this.devPort],
        define,
      );
    });
  }

  list(): ReturnType<typeof listViteState> {
    return listViteState();
  }

  get(): NonNullable<ReturnType<typeof getViteState>> {
    const value = getViteState(this.devPort);
    if (!value) throw new Error(`未找到 Vite 开发端口: ${this.devPort}`);
    return value;
  }
  mergeStatePlugin(define: Record<string, unknown>): Plugin {
    return {
      name: `mergeStatePlugin${this.devPort}`,
      enforce: "pre",
      configResolved: async config => {
        this.mergeState({ ...define, devPort: this.devPort, packagePath: config.root })
      },
    }
  }

  writeFilePlugin(define: Record<string, unknown> = {}): Plugin {
    return {
      name: `writeFilePlugin${this.devPort}`,
      enforce: "post",
      configResolved: async ({ root }) => {
        const declareDirectory = path.join(root, "src");
        await mkdir(declareDirectory, { recursive: true });
        await fsWriteFile(
          path.join(declareDirectory, `declare.ts`),
          `export default ${JSON.stringify({ ...getViteState(this.devPort), ...define }, null, 2)} as const;`,
          "utf8",
        );
      }
    }
  }
}
