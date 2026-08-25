import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { isAbsolute } from "node:path";
import { z } from "zod";

const webrtcsignalingStateValidator = z.object({
  webrtcsignaling: z.object({
    entry: z.union([
      z.literal(""),
      z.string().regex(/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~\/-]+\.tsx?$/),
    ]),
    path: z.union([
      z.literal(""),
      z.string().trim().min(1).refine(isAbsolute, { message: "path 必须是绝对路径" }),
    ]),
    listenPort: z.literal(9001),
    pathname: z.literal("/signal"),
  }).strict(),
}).strict();
const webrtcsignalingRegisterValidator = z.object({
  entry: z.string().regex(/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~\/-]+\.tsx?$/),
  path: z.string().trim().min(1).refine(isAbsolute, { message: "path 必须是绝对路径" }),
}).strict();

type WebrtcsignalingState = z.infer<typeof webrtcsignalingStateValidator>;
type WebrtcsignalingRegister = z.infer<typeof webrtcsignalingRegisterValidator>;
type WebrtcsignalingStore = WebrtcsignalingState & {
  webrtcsignalingActions: {
    register(registration: WebrtcsignalingRegister): void;
  };
};

const webrtcsignalingStore: ImmerStateCreator<WebrtcsignalingStore> = set => ({
  ...webrtcsignalingStateValidator.parse({
    webrtcsignaling: { entry: "", path: "", listenPort: 9001, pathname: "/signal" },
  }),
  webrtcsignalingActions: {
    register(registration) {
      const input = webrtcsignalingRegisterValidator.parse(registration);
      set(state => {
        state.webrtcsignaling = {
          entry: input.entry,
          path: input.path,
          listenPort: state.webrtcsignaling.listenPort,
          pathname: state.webrtcsignaling.pathname,
        };
      });
    },
  },
});

export default webrtcsignalingStore;
