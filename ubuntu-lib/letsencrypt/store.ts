import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const letsencryptStore: ImmerStateCreator<{
  letsencrypt: {
    root: "/etc/extends-ssh/certificates";
  };
}> = () => ({
  letsencrypt: {
    root: "/etc/extends-ssh/certificates",
  },
});

export default letsencryptStore;
