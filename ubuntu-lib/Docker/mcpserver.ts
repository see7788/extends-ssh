import mcpserver from "mcpserver";
import Docker from "./index.ts";


export default mcpserver.metas("/docker").add({
  protocol: "tool",
  path: "/setup",
  description: "检查远端 Docker，缺少时完成安装并验证可用性。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    await new Docker().setup();
    return { ready: true };
  },
})
