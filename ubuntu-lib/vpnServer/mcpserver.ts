import mcpserver from "mcpserver";
import VpnServer from "./index.ts";
import { configureInputValidator, ensureInputValidator } from "./zod.ts";

const vpnServer = new VpnServer();

export default mcpserver.metas("/vpnServer")
  .add({
    protocol: "tool",
    path: "/ensure",
    description: "在 Ubuntu 云服务器安装并启动 Mihomo；未传 url 时使用文件顶部 vpnConfig.subscription.url，传入 url 时使用本次地址；vpnConfig.proxySelection 可指定代理组和节点。",
    schema: ensureInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      return vpnServer.ensure(input.url);
    },
  })
  .add({
    protocol: "tool",
    path: "/configure",
    description: "把完整 Clash/Mihomo 订阅地址写入 Ubuntu 云服务器并重建 Mihomo 配置；订阅地址不会在结果中回显。",
    schema: configureInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      await vpnServer.configure(input.url);
      return vpnServer.status();
    },
  })
  .add({
    protocol: "tool",
    path: "/status",
    description: "读取 Ubuntu Mihomo 服务状态、TUN 状态和本机代理端口。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => vpnServer.status(),
  })
  .add({
    protocol: "tool",
    path: "/hasRemote",
    description: "检查 Ubuntu Mihomo 服务是否已运行并创建 TUN 网卡。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => ({ hasRemote: await vpnServer.hasRemote() }),
  });
