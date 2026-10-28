import { z } from "zod";

const devPortValidator = z.number().int().min(1).max(65_535);
export const processValidator = z.object({
  port: devPortValidator,
  cwd: z.string().trim().min(1).refine(value => value.startsWith("/") && !value.includes("\0") && !value.includes("\\"), "cwd 必须是 Linux 绝对路径"),
  command: z.string().trim().min(1),
  environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
}).strict();
export const inputValidator = z.object({ port: devPortValidator }).strict();
