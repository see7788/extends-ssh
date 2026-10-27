import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

type NginxState = {
  nginx: {
    root: string;
  };
};

const nginxStore: ImmerStateCreator<NginxState> = () => ({
  nginx: {
    root: "/www/server/panel/vhost/nginx",
  },
});

export default nginxStore;
