import { isAbsolute } from "node:path";
import { z } from "zod";

const devPortValidator = z.number().int().min(1).max(65_535);
export const makeRemoteValidator = z.object({
  port: devPortValidator,
  localPath: z.string().trim().min(1).refine(isAbsolute, "localPath 必须是绝对路径"),
}).strict();
export const getRemoteValidator = z.object({ port: devPortValidator }).strict();
