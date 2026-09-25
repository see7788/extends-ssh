import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
type ServerRootState = {
  serverRoot: Record<number, string>;
};

const serverRootStore: ImmerStateCreator<ServerRootState> = () => ({ serverRoot: {} });

export default serverRootStore;
