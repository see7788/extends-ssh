import mcpserver from "mcpserver";
import Docker from "./index.ts";

const docker = new Docker();

export default mcpserver.metas("/docker").add({
  protocol: "tool",
  path: "/ensure",
  description: "检查远端 Docker，缺少时完成安装并验证可用性。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    await docker.setupReady();
    return { ready: true };
  },
})
  .add({
    protocol: "tool",
    path: "/hasRemote",
    description: "检查远端 Docker 是否已经运行，不执行安装。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => ({ hasRemote: await docker.hasRemote() }),
  });
