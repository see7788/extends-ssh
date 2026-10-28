import mcpserver from "mcpserver";
import { posix } from "node:path";
import Nginx from "./index.ts";
import { inputValidator, makeInputValidator } from "./zod.ts";

export default mcpserver.metas("/nginx")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口或远程目录写入 HTTPS Nginx 路由；域名 DNS 需指向 SSH 主机。", schema: makeInputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const value = makeInputValidator.parse(input); const port = value.port ?? Number(posix.basename(value.path!)); const nginx = new Nginx(value.service, value.path === undefined ? port : (value.path as `${string}/${number}`)); return { url: (await nginx.makeRemote()).url }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口对应的 HTTPS Nginx 路由是否已写入。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const nginx = new Nginx(input.service, input.port); return { hasRemote: await nginx.hasRemote() }; } })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的 HTTPS Nginx 路由配置。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const nginx = new Nginx(input.service, input.port); return { url: (await nginx.getRemote()).url }; } })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭开发端口对应的 HTTPS Nginx 路由。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const nginx = new Nginx(input.service, input.port); await nginx.closeRemote(); return { closed: true }; } });
