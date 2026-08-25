import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { z } from "zod";

export const sshValidator = z.object({
  ssh: z.object({
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65_535),
    username: z.string().trim().min(1),
    password: z.string().min(1),
  }).strict(),
}).strict();

type SshStore = z.infer<typeof sshValidator>;

const sshStore: ImmerStateCreator<SshStore> = () => sshValidator.parse({
  ssh: {
    host: "82.156.162.242",
    port: 54321,
    username: "root",
    password: "9K78s98[98]j.9",
  },
});

export default sshStore;
