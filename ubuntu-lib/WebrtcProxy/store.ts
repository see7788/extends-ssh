import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

type WebrtcProxyStore = {
  webrtcProxy: {
    port: number;
    path: string;
  };
};

const webrtcProxyStore: ImmerStateCreator<WebrtcProxyStore> = () => ({
  webrtcProxy: {
    port: 9001,
    path: "/signal",
  },
});

export default webrtcProxyStore;
