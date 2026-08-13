import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

type nodeState_t = {
  path_isAbsolute_nodestate: typeof import("node:path").isAbsolute;
};

type WebrtcsignalingStore = {
  webrtcsignaling: {
    entry: string;
    path: string;
    listenPort: 9001;
    pathname: "/signal";
  };
  webrtcsignalingActions: {
    register(registration: { entry: string; path: string }): void;
  };
};

const webrtcsignalingStore: ImmerStateCreator<WebrtcsignalingStore, nodeState_t> = (set, get) => ({
  webrtcsignaling: {
    entry: "",
    path: "",
    listenPort: 9001,
    pathname: "/signal",
  },
  webrtcsignalingActions: {
    register(registration) {
      if (!get().path_isAbsolute_nodestate(registration.path)) {
        throw new TypeError(`WebRTC 信令源码目录必须是绝对路径: ${registration.path}`);
      }
      if (
        !/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~/-]+\.tsx?$/.test(registration.entry)
      ) {
        throw new TypeError(`WebRTC 信令 TypeScript 入口无效: ${registration.entry}`);
      }
      set(state => {
        state.webrtcsignaling = {
          entry: registration.entry,
          path: registration.path,
          listenPort: state.webrtcsignaling.listenPort,
          pathname: state.webrtcsignaling.pathname,
        };
      });
    },
  },
});

export type { nodeState_t };
export default webrtcsignalingStore;
