import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
type ServerRootState = {
  serverRoot: Record<number, {
    packagePath: string;
    define: Record<string, any>;
  }>;
};

// export default (() => ({ serverRoot: {} })) satisfies ImmerStateCreator<ServerRootState>
export const c: ImmerStateCreator<ServerRootState>=() => ({ serverRoot: {} })
export default c