import mcpserver from "mcpserver";
import VpnMihomo from "./index.ts";
import store from "../store.ts";


export default mcpserver.metas("/vpnMihomo")
  .add({
    protocol: "tool",
    path: "/setup",
    description: "准备 Mihomo 环境；检测到远程服务不健康时，按 store 配置恢复并启动服务。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => {
      await new VpnMihomo().setupReady();
      return { ready: true };
    },
  })
  .add({
    protocol: "tool",
    path: "/set",
    description: "将 store 中的完整 Mihomo 配置应用到远端并重启服务。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => {
      await new VpnMihomo().set();
      return { set: true };
    },
  })
  .add({
    protocol: "tool",
    path: "/stop",
    description: "停止 Ubuntu 云服务器上的 Mihomo 服务。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => {
      await new VpnMihomo().stop();
      return { stopped: true };
    },
  })
  .add({
    protocol: "tool",
    path: "/persist",
    description: "空修改当前 Mihomo store，仅用于生成或刷新持久化文件，不改变配置值。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: () => {
      store.setState(state => {
        state.vpnMihomo.subscriptionUrl = state.vpnMihomo.subscriptionUrl;
      });
      return { persisted: true, vpnMihomo: store.getState().vpnMihomo };
    },
  });
