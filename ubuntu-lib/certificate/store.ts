import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const defaultRoot = "/etc/extends-ssh/certificates";

const certificateStore: ImmerStateCreator<{
  certificate: {
    root: string;
  };
}> = () => ({
  certificate: {
    root: defaultRoot,
  },
});

export default certificateStore;
