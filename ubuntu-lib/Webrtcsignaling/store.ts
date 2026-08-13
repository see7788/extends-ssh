import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";
import { isAbsolute } from "node:path";

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

const webrtcsignalingStore: ImmerStateCreator<WebrtcsignalingStore> = set => ({
  webrtcsignaling: {
    entry: "",
    path: "",
    listenPort: 9001,
    pathname: "/signal",
  },
  webrtcsignalingActions: {
    register(registration) {
      if (!isAbsolute(registration.path)) {
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

export default webrtcsignalingStore;
