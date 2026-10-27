import { z } from "zod";

export const sshExecuteValidator = z.object({
  command: z.string().trim().min(1),
}).strict();
export const portValidator = z.object({ port: z.number().int().min(1).max(65_535) }).strict();
