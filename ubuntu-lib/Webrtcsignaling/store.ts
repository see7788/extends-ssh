import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";
import { isAbsolute } from "node:path";

type WebrtcsignalingStore = {
  webrtcsignaling: {
    path: string;
    jwtSecret: string;
    port: number;
    pathname: string;
  };
  webrtcsignalingActions: {
    register(registration: { path: string; jwtSecret: string }): void;
  };
};

const webrtcsignalingStore: ImmerStateCreator<WebrtcsignalingStore> = set => ({
  webrtcsignaling: {
    path: "",
    jwtSecret: "",
    port: 9001,
    pathname: "/signal",
  },
  webrtcsignalingActions: {
    register(registration) {
      if (!isAbsolute(registration.path)) {
        throw new TypeError(`WebRTC 信令产物路径必须是绝对路径: ${registration.path}`);
      }
      if (!registration.jwtSecret.trim()) {
        throw new TypeError("WebRTC 信令 JWT secret 不能为空");
      }
      set(state => {
        const pathname = state.webrtcsignaling.pathname
          || (state.webrtcsignaling.path.startsWith("/") ? state.webrtcsignaling.path : "/signal");
        state.webrtcsignaling = {
          path: registration.path,
          jwtSecret: registration.jwtSecret,
          port: state.webrtcsignaling.port,
          pathname,
        };
      });
    },
  },
});

export default webrtcsignalingStore;
