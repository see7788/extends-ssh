import mcpserver from "mcpserver";
import SshForward from "./index.ts";
import { inputValidator } from "./zod.ts";

const sshForward = new SshForward();

export default mcpserver.metas("/sshForward")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口建立 SSH 远端端口转发", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await sshForward.makeRemote(input.port); return { remotePort: remote.remotePort }; } })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的 SSH 远端端口", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await sshForward.getRemote(input.port); return { remotePort: remote.remotePort }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口当前的 SSH 内网穿透句柄及远程监听。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await sshForward.hasRemote(input.port) }) })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭开发端口对应的 SSH 内网穿透。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await sshForward.closeRemote(input.port); return { closed: true }; } })
  .add({ protocol: "tool", path: "/dispose", description: "关闭全部 SSH 内网穿透。", schema: {}, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async () => { await sshForward.dispose(); return { disposed: true }; } });
