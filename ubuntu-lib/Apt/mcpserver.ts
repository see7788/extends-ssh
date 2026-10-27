import mcpserver from "mcpserver";
import Apt from "./index.ts";

const apt = new Apt();

export default mcpserver.metas("/apt").add({
  protocol: "tool",
  path: "/ensure",
  description: "检查并补齐远端系统所需的 Apt 基础组件。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    await apt.setupReady();
    return { ready: true };
  },
})
