import mcpserver from "mcpserver";
import Nodejs from "./index.ts";

const nodejs = new Nodejs();

export default mcpserver.metas("/nodejs").add({
  protocol: "tool",
  path: "/ensure",
  description: "确保远端 Node.js 运行环境可用。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    await nodejs.setupReady();
    return { ready: true };
  },
})
