import mcpserver from "mcpserver";
import FrpForward from "./index.ts";
import { inputValidator } from "./zod.ts";

const forwards = new Map<number, FrpForward>();
const getForward = (port: number): FrpForward => {
  const current = forwards.get(port);
  if (current) return current;
  const forward = new FrpForward(port);
  forwards.set(port, forward);
  return forward;
};

export default mcpserver.metas("/frp")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口建立 frp 远端端口转发。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ remotePort: (await getForward(input.port).makeRemote()).remotePort }) })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的 frp 远端端口。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ remotePort: (await getForward(input.port).getRemote()).remotePort }) })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口当前的 frpc 进程和转发句柄。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await getForward(input.port).hasRemote() }) })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭开发端口对应的 frp 远端端口转发。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await getForward(input.port).closeRemote(); return { closed: true }; } });
