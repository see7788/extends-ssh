import { z } from "zod";

export const subscriptionUrlValidator = z.string().trim().url().refine(value => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "订阅地址必须使用 http 或 https");
