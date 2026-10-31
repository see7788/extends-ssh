import { z } from "zod";

export const hostnameValidator = z.string().trim().toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i);
export const inputValidator = z.object({ hostname: hostnameValidator }).strict();
export const makeRemoteInputValidator = inputValidator.extend({
  nginxBinary: z.string().trim().min(1),
  nginxConfig: z.string().trim().min(1),
}).strict();
