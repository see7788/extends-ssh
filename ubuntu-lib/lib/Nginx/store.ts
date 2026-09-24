import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";


const nginxStore: ImmerStateCreator<{
  nginx: {
    sitesAvailableRoot: string;
    sitesEnabledRoot: string;
  };
}> = () => ({
  nginx: {
    sitesAvailableRoot: "/etc/nginx/sites-available",
    sitesEnabledRoot: "/etc/nginx/sites-enabled",
  },
});

export default nginxStore;
