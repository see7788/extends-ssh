import immerStateCreator from "extends-zustand/immerStateCreator";

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

export default immerStateCreator<WebrtcProxyStore>(() => ({
  webrtcProxy: {
    peerServer: {
      port: 9001,
      path: "/signal",
    },
    stunServer: {
      port: 3478,
    },
  },
}));
