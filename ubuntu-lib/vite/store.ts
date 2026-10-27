import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
type ViteState = {
  vite: Record<number, Record<string, unknown>&{ packagePath:string}>;
};

const viteStore: ImmerStateCreator<ViteState> = () => ({ vite: {} });
export default viteStore;
