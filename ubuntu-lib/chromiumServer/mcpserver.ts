import mcpserver from "mcpserver";
import ChromiumServer from "./index.ts";
import { indexInputValidator } from "./zod.ts";

const chromiumServer = new ChromiumServer();

export default mcpserver.metas("/chromiumServer")
  .add({
    protocol: "tool",
    path: "/setup",
    description: "Ensure one Chromium instance is running.",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => { await chromiumServer.setup(); return { ready: true }; },
  })
  .add({
    protocol: "tool",
    path: "/set",
    description: "Apply the stored configuration for one Chromium instance.",
    schema: indexInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => { await chromiumServer.set(input.index); return { updated: true }; },
  })
  .add({
    protocol: "tool",
    path: "/add",
    description: "Start one Chromium instance using its stored configuration.",
    schema: indexInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => { await chromiumServer.add(input.index); return { added: true }; },
  })
  .add({
    protocol: "tool",
    path: "/stop",
    description: "Stop one Chromium instance without deleting its configuration.",
    schema: indexInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => { await chromiumServer.stop(input.index); return { stopped: true }; },
  })
  .add({
    protocol: "tool",
    path: "/del",
    description: "Remove one Chromium instance and its remote service.",
    schema: indexInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    handler: async input => { await chromiumServer.del(input.index); return { deleted: true }; },
  });
