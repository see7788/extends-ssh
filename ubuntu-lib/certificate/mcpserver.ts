import mcpserver from "mcpserver";
import Certificate from "./index.ts";
import { inputValidator } from "./zod.ts";

const certificate = new Certificate();

export default mcpserver.metas("/certificate").add({
  protocol: "tool",
  path: "/ensure",
  description: "为指定域名生成并确保可用的自签名 TLS 证书。",
  schema: inputValidator.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async input => {
    return certificate.makeRemote(input.hostname);
  },
})
  .add({
    protocol: "tool",
    path: "/hasRemote",
    description: "检查指定域名的远端证书是否有效，不执行安装或生成。",
    schema: inputValidator.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => ({ hasRemote: await certificate.hasRemote(input.hostname) }),
  });
