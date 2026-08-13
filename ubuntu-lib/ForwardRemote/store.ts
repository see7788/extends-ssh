import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

type ForwardRemoteStore = {
  forwardRemote: {
    path: string;
    remotePath: string;
    jwtSecret: string;
  };
};

const forwardRemoteStore: ImmerStateCreator<ForwardRemoteStore> = () => ({
  forwardRemote: {
    path: "",
    remotePath: "/www/wwwroot/extends-ssh/webrtcsignaling",
    jwtSecret: "",
  },
});

export default forwardRemoteStore;
