import mcpserver from "mcpserver";
import KasmVnc from "./index.ts";
import { indexInputValidator } from "./zod.ts";


export default mcpserver.metas("/kasmVnc")
  .add({
    protocol: "tool",
    path: "/setup",
    description: "Ensure one KasmVNC instance is running.",
    schema: indexInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => { await new KasmVnc(input.index).setupReady(); return { ready: true }; },
  })
  .add({
    protocol: "tool",
    path: "/set",
    description: "Apply the stored configuration for one KasmVNC instance.",
    schema: indexInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => { await new KasmVnc(input.index).set(); return { updated: true }; },
  })
  .add({
    protocol: "tool",
    path: "/add",
    description: "Start one KasmVNC instance using its stored configuration.",
    schema: indexInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => { await new KasmVnc(input.index).add(); return { added: true }; },
  })
  .add({
    protocol: "tool",
    path: "/stop",
    description: "Stop one KasmVNC instance without deleting its configuration.",
    schema: indexInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => { await new KasmVnc().stop(input.index); return { stopped: true }; },
  })
  .add({
    protocol: "tool",
    path: "/del",
    description: "Remove one KasmVNC instance and its remote service.",
    schema: indexInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    handler: async input => { await new KasmVnc().del(input.index); return { deleted: true }; },
  });
