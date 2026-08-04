import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

export type ViteStore = {
  vite: {
    remoteRoot: string;
  };
};

const store = <T extends object = {}>(
  ..._args: Parameters<ImmerStateCreator<ViteStore, T>>
): ViteStore => ({
  vite: {
    remoteRoot: "/www/wwwroot/extends-ssh",
  },
});

export default store;
