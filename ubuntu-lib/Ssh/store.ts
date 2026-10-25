import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
//10000-15999端口已经开放
// 服务器环境：Ubuntu 22.04。
// 云服务商：腾讯云。
// 宝塔面板：https://82.156.162.242:22947/d9450c6f
// 宝塔用户名：hazwa0sx
// 宝塔密码：9K78s98[98]j.9
const sshStore: ImmerStateCreator<{
  ssh: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
}> = () => ({
  ssh: {
    host: "82.156.162.242",
    port: 54321,
    username: "root",
    password: "9K78s98[98]j.9",
  }
});

export default sshStore;