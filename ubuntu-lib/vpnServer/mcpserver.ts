import mcpserver from "mcpserver";
import VpnServer from "./index.ts";

const vpnServer = new VpnServer();

export default mcpserver.metas("/vpnServer")
  .add({
    protocol: "tool",
    path: "/setup",
    description: "准备并启动 Ubuntu 云服务器上的 Mihomo 运行环境。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => {
      await vpnServer.setup();
      return { ready: true };
    },
  })
  .add({
    protocol: "tool",
    path: "/update",
    description: "使用可选订阅地址更新 Ubuntu 云服务器上的 Mihomo 配置并重启服务。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => {
      await vpnServer.update();
      return { updated: true };
    },
  });
