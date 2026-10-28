import mcpserver from "mcpserver";
import Pm2 from "./index.ts";
import { inputValidator, processValidator } from "./zod.ts";

const server = mcpserver.metas("/pm2");
server.add({ protocol: "tool", path: "/makeRemote", description: "按开发端口、工作目录和命令创建远端 PM2 进程。", schema: processValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { return { name: (await new Pm2().makeRemote(input)).name }; } });
server.add({ protocol: "tool", path: "/hasRemote", description: "检查端口对应的 PM2 进程是否已存在。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await new Pm2().hasRemote(input.port) }) });
server.add({ protocol: "tool", path: "/getRemote", description: "检查并读取端口对应的 PM2 进程标识。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { return { name: (await new Pm2().getRemote(input.port)).name }; } });
server.add({ protocol: "tool", path: "/refresh", description: "刷新端口对应的 PM2 进程状态。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: input => new Pm2().refresh(input.port) });
server.add({ protocol: "tool", path: "/stop", description: "停止端口对应的 PM2 进程。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await new Pm2().stop(input.port); return { stopped: true }; } });
server.add({ protocol: "tool", path: "/restart", description: "重启端口对应的 PM2 进程。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await new Pm2().restart(input.port); return { restarted: true }; } });
server.add({ protocol: "tool", path: "/closeRemote", description: "关闭端口对应的 PM2 进程。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await new Pm2().closeRemote(input.port); return { closed: true }; } });

export default server;
