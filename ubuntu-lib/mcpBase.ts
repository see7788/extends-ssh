import { z } from "zod";

export const emptyValidator = z.object({}).strict();

export const read = [true, false, true, false] as const;

export const remoteRead = {
  ...read,
  openWorldHint: true,
} as const;

export const mutate = [false, false, true, true] as const;

export type McpResourceContext = {
  json(body: unknown): unknown;
};

export type McpJsonContext<Input> = {
  req: {
    valid(name: "json"): Input;
  };
  json(body: unknown, status?: number): unknown;
};
