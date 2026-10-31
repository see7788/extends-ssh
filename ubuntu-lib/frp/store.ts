import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const frpStore: ImmerStateCreator<{
  frp: {
    clientBinary: string;
    version: string;
    serverAddr: string;
    serverPort: number;
    token: string;
  };
}> = () => ({
  frp: {
    clientBinary: "",
    version: "0.70.1",
    serverAddr: "",
    serverPort: 7000,
    token: "",
  },
});

export default frpStore;
