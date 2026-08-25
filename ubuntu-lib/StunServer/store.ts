import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { z } from "zod";

export const stunServerValidator = z.object({
  stunServer: z.object({
    port: z.number().int().min(1).max(65_535),
  }).strict(),
}).strict();

type StunServerStore = z.infer<typeof stunServerValidator>;

const stunServerStore: ImmerStateCreator<StunServerStore> = () => stunServerValidator.parse({
  stunServer: {
    port: 3478,
  },
});

export default stunServerStore;
