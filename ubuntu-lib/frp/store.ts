import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const frpStore: ImmerStateCreator<{
  frp: {
    root: "/opt/frp";
    binary: "/usr/local/bin/frps";
    config: "/etc/frp/frps.toml";
    service: "frps.service";
    serverPort: 7000;
  };
}> = () => ({
  frp: {
    root: "/opt/frp",
    binary: "/usr/local/bin/frps",
    config: "/etc/frp/frps.toml",
    service: "frps.service",
    serverPort: 7000,
  },
});

export default frpStore;
