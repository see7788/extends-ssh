import mcpserver from "mcpserver";
import Docker from "./index.ts";


export default mcpserver.metas("/docker").add({
  protocol: "tool",
  path: "/ensure",
  description: "检查远端 Docker，缺少时完成安装并验证可用性。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    await new Docker().setupReady();
    return { ready: true };
  },
})
