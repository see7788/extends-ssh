import mcpserver from "mcpserver";
import SshForward from "./index.ts";
import { inputValidator } from "./zod.ts";

const forwards = new Map<number, SshForward>();
const getForward = (port: number): SshForward => {
  const current = forwards.get(port);
  if (current) return current;
  const forward = new SshForward(port);
  forwards.set(port, forward);
  return forward;
};

export default mcpserver.metas("/sshForward")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口建立 SSH 远端端口转发", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { return { remotePort: (await getForward(input.port).makeRemote()).remotePort }; } })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的 SSH 远端端口", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { return { remotePort: (await getForward(input.port).getRemote()).remotePort }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口当前的 SSH 内网穿透句柄及远程监听。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const sshForward = getForward(input.port); return { hasRemote: await sshForward.hasRemote() }; } })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭开发端口对应的 SSH 内网穿透。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await getForward(input.port).closeRemote(); return { closed: true }; } });
