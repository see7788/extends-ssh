import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

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
