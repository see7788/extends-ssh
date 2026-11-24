import { z } from "mcpserver";

export const inputValidator = z.object({
  port: z.number().int().min(1).max(65_535),
}).strict();
