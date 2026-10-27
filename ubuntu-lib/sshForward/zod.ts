import { z } from "zod";

const devPortValidator = z.number().int().min(1).max(65_535);
export const inputValidator = z.object({ port: devPortValidator }).strict();
