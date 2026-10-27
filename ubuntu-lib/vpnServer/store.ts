import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

type VpnServerState = {
  vpnServer: {
    subscriptionUrl: string;
    proxySelection: {
      groupName: string;
      proxyName: string;
    };
    mixedPort: number;
    socksPort: number;
    redirPort: number;
    externalController: string;
    tunName: string;
    tunStack: string;
    tunAutoRoute: boolean;
    tunAutoRedirect: boolean;
    tunAutoDetectInterface: boolean;
    mode: string;
    allowLan: boolean;
    dns: {
      enable: boolean;
      listen: string;
      enhancedMode: string;
      nameservers: string[];
    };
  };
};

const vpnServerStore: ImmerStateCreator<VpnServerState> = () => ({
  vpnServer: {
    subscriptionUrl: "http://43.135.28.238/link/cKugdo3G28Iep4tV?clash=2",
    proxySelection: {
      groupName: "",
      proxyName: "",
    },
    mixedPort: 7_890,
    socksPort: 7_891,
    redirPort: 7_892,
    externalController: "127.0.0.1:9_090",
    tunName: "mihomo",
    tunStack: "system",
    tunAutoRoute: true,
    tunAutoRedirect: true,
    tunAutoDetectInterface: true,
    mode: "rule",
    allowLan: false,
    dns: {
      enable: true,
      listen: "127.0.0.1:7_895",
      enhancedMode: "fake-ip",
      nameservers: ["223.5.5.5", "1.1.1.1"],
    },
  },
});

export default vpnServerStore;
