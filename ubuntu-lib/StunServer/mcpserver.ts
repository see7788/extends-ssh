import mcpserver from "mcpserver";
import StunServer from "./index.ts";


export default mcpserver.metas("/stunServer")
  .add({
    protocol: "tool",
    path: "/setup",
    description: "确保远端 STUN 服务处于可用状态。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => {
      await new StunServer().setupReady();
      return { ready: true };
    },
  })
  .add({
    protocol: "tool",
    path: "/update",
    description: "将 store 中的 STUN 配置应用到远端服务。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    handler: async () => {
      await new StunServer().update();
      return { updated: true };
    },
  });
