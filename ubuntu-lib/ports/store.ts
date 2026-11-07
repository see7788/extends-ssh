import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
//ownerKey端口使用者
const postsStore: ImmerStateCreator<{
  ports: Record<number, Record<string, unknown> & { ownerKey: string }>;
}> = () => ({
  ports: {},
});

export default postsStore;
