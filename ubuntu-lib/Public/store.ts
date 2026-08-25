import { posix } from "node:path";
import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { z } from "zod";

export const publicValidator = z.object({
  public: z.object({
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
    remoteRoot: z
      .string()
      .trim()
      .min(1)
      .refine(
        value => value.startsWith("/")
          && !value.includes("\0")
          && !value.includes("\\")
          && posix.normalize(value) === value,
        { message: "remoteRoot 必须是规范化的 Linux 绝对路径" },
      ),
  }).strict(),
}).strict();

type PublicStore = z.infer<typeof publicValidator>;

const publicStore: ImmerStateCreator<PublicStore> = () => publicValidator.parse({
  public: {
    domain: "13520521413.store",
    remoteRoot: "/www/wwwroot/extends-ssh",
  },
});

export default publicStore;
