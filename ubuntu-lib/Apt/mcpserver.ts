import mcpserver from "mcpserver";
import Apt from "./index.ts";


export default mcpserver.metas("/apt").add({
  protocol: "tool",
  path: "/setup",
  description: "检查并补齐远端系统所需的 Apt 基础组件。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    await new Apt().setup();
    return { ready: true };
  },
})
