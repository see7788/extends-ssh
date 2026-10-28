import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const nginxStore: ImmerStateCreator<{
  nginx: {
    root: "/www/server/panel/vhost/nginx";
    binary: "/www/server/nginx/sbin/nginx";
    config: "/www/server/nginx/conf/nginx.conf";
  };
}> = () => ({
  nginx: {
    root: "/www/server/panel/vhost/nginx",
    binary: "/www/server/nginx/sbin/nginx",
    config: "/www/server/nginx/conf/nginx.conf",
  },
});

export default nginxStore;
