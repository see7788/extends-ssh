import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const certificateStore: ImmerStateCreator<{
  certificate: {
    root: "/etc/extends-ssh/certificates";
  };
}> = () => ({
  certificate: {
    root: "/etc/extends-ssh/certificates",
  },
});

export default certificateStore;
