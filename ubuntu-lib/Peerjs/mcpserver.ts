import mcpserver from "mcpserver";
import Peerjs from "./index.ts";


export default mcpserver.metas("/peerjs")
  .add({
    protocol: "tool",
    path: "/state",
    description: "读取 PeerJS 连接配置。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: () => new Peerjs().endpoint,
  })
  .add({
    protocol: "tool",
    path: "/ensure",
    description: "检查并确保远端 PeerJS 服务处于可用状态。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => { const peerjs = new Peerjs(); await peerjs.setupReady(); return peerjs.endpoint; },
  });
