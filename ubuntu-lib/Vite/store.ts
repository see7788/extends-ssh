import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

type ViteStore = {
  vite: {
    remoteRoot: string;
  };
};

const viteStore: ImmerStateCreator<ViteStore> = () => ({
  vite: {
    remoteRoot: "/www/wwwroot/extends-ssh",
  },
});

export default viteStore;
