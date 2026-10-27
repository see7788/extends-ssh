import mcpserver from "mcpserver";
import StunServer from "./index.ts";

const stunServer = new StunServer();

export default mcpserver.metas("/stunServer")
  .add({
    protocol: "tool",
    path: "/hasRemote",
    description: "检查远端 STUN 服务是否已经运行，不执行安装。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => ({ hasRemote: await stunServer.hasRemote() }),
  })
  .add({
    protocol: "tool",
    path: "/state",
    description: "确保并读取 STUN 连接配置。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => stunServer.status(),
  })
  .add({
    protocol: "tool",
    path: "/ensure",
    description: "检查并确保远端 STUN 服务处于可用状态。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => {
      await stunServer.setupReady();
      return { ready: true };
    },
  });
