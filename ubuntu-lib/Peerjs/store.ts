import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

type PeerjsStore = {
  peerjs: {
    image: "peerjs/peerjs-server:1.0.2";
    key: "peerjs";
    listenPort: 9000;
    pathname: "/peerjs";
  };
};

const peerjsStore: ImmerStateCreator<PeerjsStore> = () => ({
  peerjs: {
    image: "peerjs/peerjs-server:1.0.2",
    key: "peerjs",
    listenPort: 9000,
    pathname: "/peerjs",
  },
});

export default peerjsStore;
