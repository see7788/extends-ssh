import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";
import { isAbsolute } from "node:path";
import type { nodeState_t } from "./store.ts";

const webrtcsignalingNodeState: ImmerStateCreator<nodeState_t> = () => ({
  path_isAbsolute_nodestate: isAbsolute,
});

export default webrtcsignalingNodeState;
