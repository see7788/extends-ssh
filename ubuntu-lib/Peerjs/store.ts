import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const peerjsStore: ImmerStateCreator<{
  peerjs: {
    image: string;
    key: string;
    listenPort: number;
    pathname: string;
  };
}> = () => ({
  peerjs: {
    image: "peerjs/peerjs-server:1.0.2",
    key: "peerjs",
    listenPort: 9000,
    pathname: "/peerjs",
  },
});

export default peerjsStore;
