import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
const viteStore: ImmerStateCreator<{
vite: Record<number, Record<string, unknown>&{ packagePath:string}>;
}> = () => ({ vite: {} });
export default viteStore;
