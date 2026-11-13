import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const frpStore: ImmerStateCreator<{
  frp: {
    service: "frps.service";
    serverPort: 7000;
  };
}> = () => ({
  frp: {
service: "frps.service",
    serverPort: 7000,
  },
});

export default frpStore;
