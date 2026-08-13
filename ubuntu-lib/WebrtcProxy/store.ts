import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";
import { isAbsolute } from "node:path";

type WebrtcProxyStore = {
  webrtcProxy: {
    path: string;
    jwtSecret: string;
    port: number;
    pathname: string;
  };
  webrtcProxyActions: {
    register(registration: { path: string; jwtSecret: string }): void;
  };
};

const webrtcProxyStore: ImmerStateCreator<WebrtcProxyStore> = set => ({
  webrtcProxy: {
    path: "",
    jwtSecret: "",
    port: 9001,
    pathname: "/signal",
  },
  webrtcProxyActions: {
    register(registration) {
      if (!isAbsolute(registration.path)) {
        throw new TypeError(`WebRTC 信令产物路径必须是绝对路径: ${registration.path}`);
      }
      if (!registration.jwtSecret.trim()) {
        throw new TypeError("WebRTC 信令 JWT secret 不能为空");
      }
      set(state => {
        const pathname = state.webrtcProxy.pathname
          || (state.webrtcProxy.path.startsWith("/") ? state.webrtcProxy.path : "/signal");
        state.webrtcProxy = {
          path: registration.path,
          jwtSecret: registration.jwtSecret,
          port: state.webrtcProxy.port,
          pathname,
        };
      });
    },
  },
});

export default webrtcProxyStore;
