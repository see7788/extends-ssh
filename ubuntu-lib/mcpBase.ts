import mcpserver from "mcpserver";
import { z } from "zod";

export const emptyValidator = z.object({}).strict();

export const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const remoteRead = {
  ...read,
  openWorldHint: true,
} as const;

export const mutate = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export type McpResourceContext = {
  json(body: unknown): unknown;
};

export type McpJsonContext<Input> = {
  req: {
    valid(name: "json"): Input;
  };
  json(body: unknown, status?: number): unknown;
};

// Keep the workspace mcpserver/Zod type mismatch at the MCP boundary.
export const mcpRegister = mcpserver.register as any;
