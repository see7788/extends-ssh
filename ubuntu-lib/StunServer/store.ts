import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

type StunServerStore = {
  stunServer: {
    port: number;
  };
};

const stunServerStore: ImmerStateCreator<StunServerStore> = () => ({
  stunServer: {
    port: 3478,
  },
});

export default stunServerStore;
