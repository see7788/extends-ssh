import immerStateCreator from "extends-zustand/immerStateCreator";

export type ViteStore = {
  vite: {
    remoteRoot: string;
  };
};

export default immerStateCreator<ViteStore>(() => ({
  vite: {
    remoteRoot: "/www/wwwroot/extends-ssh",
  },
}));
