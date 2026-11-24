import { z } from "mcpserver";

export const indexInputValidator = z.object({
  index: z.number().int().min(0),
}).strict();
