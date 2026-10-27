import { z } from "zod";

export const targetUrlValidator = z.string().trim().url().refine(value => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "目标地址必须使用 http 或 https");
export const targetInputValidator = z.object({ url: targetUrlValidator }).strict();
