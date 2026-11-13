import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const peerjsStore: ImmerStateCreator<{
  peerjs: {
    key: string;
    listenPort: number;
    pathname: string;
  };
}> = () => ({
  peerjs: {
    key: "peerjs",
    listenPort: 9000,
    pathname: "/peerjs",
  },
});

export default peerjsStore;
