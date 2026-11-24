import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const vpnMihomoStore: ImmerStateCreator<{
  vpnMihomo: {
    subscriptionUrl: string;
    proxySelection: {
      groupName: string;
      proxyName: string;
    };
    tunName: string;
    tunStack: string;
    tunAutoRoute: boolean; // true=自动配置路由；false=不自动配置路由
    tunAutoRedirect: boolean; // true=自动重定向流量；false=不自动重定向流量
    tunAutoDetectInterface: boolean; // true=自动检测出口网卡；false=不自动检测出口网卡
    mode: string;
    allowLan: boolean; // true=允许局域网访问；false=仅允许本机访问
    dns: {
      enable: boolean; // true=启用 DNS；false=禁用 DNS
      enhancedMode: string;
      nameservers: string[];
      fakeIpFilter: string[];
    };
  };
}> = () => ({
  vpnMihomo: {
    subscriptionUrl: "http://43.135.28.238/link/cKugdo3G28Iep4tV?clash=2",
    proxySelection: {
      groupName: "",
      proxyName: "",
    },
    tunName: "mihomo",
    tunStack: "system",
    tunAutoRoute: true,
    tunAutoRedirect: true,
    tunAutoDetectInterface: true,
    mode: "rule",
    allowLan: false,
    dns: {
      enable: true,
      enhancedMode: "fake-ip",
      nameservers: ["223.5.5.5", "1.1.1.1"],
      fakeIpFilter: [
        "+.taobao.com",
        "+.baidu.com",
        "archive.ubuntu.com",
        "security.ubuntu.com",
        "mirrors.tencentyun.com",
        "dldir1v6.qq.com",
      ],
    },
  },
});

export default vpnMihomoStore;
