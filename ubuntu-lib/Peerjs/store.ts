import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { z } from "zod";

export const peerjsValidator = z.object({
  peerjs: z.object({
    image: z.literal("peerjs/peerjs-server:1.0.2"),
    key: z.literal("peerjs"),
    listenPort: z.literal(9000),
    pathname: z.literal("/peerjs"),
  }).strict(),
}).strict();

type PeerjsStore = z.infer<typeof peerjsValidator>;

const peerjsStore: ImmerStateCreator<PeerjsStore> = () => peerjsValidator.parse({
  peerjs: {
    image: "peerjs/peerjs-server:1.0.2",
    key: "peerjs",
    listenPort: 9000,
    pathname: "/peerjs",
  },
});

export default peerjsStore;
