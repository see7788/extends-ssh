import mcpserver from "mcpserver";
import Sftp from "./index.ts";
import { getRemoteValidator, makeRemoteValidator } from "./zod.ts";

const sftp = new Sftp();

export default mcpserver.metas("/sftp")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口建立并首次同步远程应用目录。", schema: makeRemoteValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await sftp.makeRemote(input); return { path: remote.path }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口对应的远程应用目录是否已分配。", schema: getRemoteValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await sftp.hasRemote(input.port) }) })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的远程应用目录。", schema: getRemoteValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await sftp.getRemote(input.port); return { path: remote.path }; } });
