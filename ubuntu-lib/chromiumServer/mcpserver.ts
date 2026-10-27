import mcpserver from "mcpserver";
import ChromiumServerKasm, { browserConfig } from "./index.ts";
import { targetInputValidator } from "./zod.ts";

const chromiumServerKasm = new ChromiumServerKasm();

export default mcpserver.metas("/chromiumServerKasm")
  .add({
    protocol: "tool",
    path: "/hasRemote",
    description: "检查 Ubuntu 云服务器上的 KasmVNC Chromium 服务是否运行。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => ({ hasRemote: await chromiumServerKasm.hasRemote() }),
  })
  .add({
    protocol: "tool",
    path: "/ensure",
    description: "安装并启动 Ubuntu 原生 Chromium 与 KasmVNC 网页桌面，默认目标为 GitHub。",
    schema: targetInputValidator.partial().shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => chromiumServerKasm.ensure(input.url ?? browserConfig.targetDefault),
  })
  .add({
    protocol: "tool",
    path: "/open",
      description: `动态设置云服务器 Chromium 要打开的目标站点。KasmVNC 网页入口保持在 ${browserConfig.publicPort} 端口。`,
    schema: targetInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => chromiumServerKasm.setTarget(input.url),
  });
