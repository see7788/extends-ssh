import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

export type WebrtcProxyStore = {
  webrtcProxy: {
    peerServer: {
      port: number;
      path: string;
    };
    stunServer: {
      port: number;
    };
  };
};

const store = <T extends object = {}>(
  ..._args: Parameters<ImmerStateCreator<WebrtcProxyStore, T>>
): WebrtcProxyStore => ({
  webrtcProxy: {
    peerServer: {
      port: 9001,
      path: "/signal",
    },
    stunServer: {
      port: 3478,
    },
  },
});

export default store;
