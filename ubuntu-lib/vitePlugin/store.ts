import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
type VitePluginState = {
  vitePlugin: Record<number, {
    packagePath: string;
    define: Record<string, unknown>;
  }>;
};

const vitePluginStore: ImmerStateCreator<VitePluginState> = () => ({ vitePlugin: {} });
export default vitePluginStore;
