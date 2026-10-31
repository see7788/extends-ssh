import mcpserver from "mcpserver";
import Nodejs from "./index.ts";


export default mcpserver.metas("/nodejs").add({
  protocol: "tool",
  path: "/setup",
  description: "确保远端 Node.js 运行环境可用。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    await new Nodejs().setup();
    return { ready: true };
  },
})
