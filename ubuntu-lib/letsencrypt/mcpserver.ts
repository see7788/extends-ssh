import mcpserver from "mcpserver";
import LetsEncrypt from "./index.ts";
import { makeRemoteInputValidator } from "./zod.ts";

export default mcpserver.metas("/letsencrypt").add({
  protocol: "tool",
  path: "/makeRemote",
  description: "为指定域名申请或复用 Let's Encrypt 受信任 TLS 证书，并部署到宝塔 Nginx 使用的证书路径；已存在且未临近过期证书会复用。",
  schema: makeRemoteInputValidator.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async input => new LetsEncrypt().makeRemote(input.hostname, input.nginxBinary, input.nginxConfig),
});
