import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
type ServerRootState = {
  serverRoot: Record<number, { packagePath: string, producerDefine: Record<string, any> }>;
};

const serverRootStore: ImmerStateCreator<ServerRootState> = () => ({ serverRoot: {} });

export default serverRootStore;