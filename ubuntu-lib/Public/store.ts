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
  }).strict(),
}).strict();

type PublicStore = z.infer<typeof publicValidator>;

const publicStore: ImmerStateCreator<PublicStore> = () => publicValidator.parse({
  public: {
    domain: "13520521413.store",
  },
});

export default publicStore;
