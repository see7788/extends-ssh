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
  .add({
    protocol: "tool",
    path: "/hasRemote",
    description: "检查远端 Apt 基础组件是否已经就绪，不执行安装。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => ({ hasRemote: await apt.hasRemote() }),
  });
