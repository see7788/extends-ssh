import Vite from "extends-ssh/Ubuntu/Vite/index.ts";
import WebrtcProxy from "extends-ssh/Ubuntu/WebrtcProxy/index.ts";
import Pm2 from "extends-ssh/Ubuntu/Pm2.ts";

class Ubuntu {
  /** 让具体业务取得并维护远程 PM2 进程数据。 */
  public readonly pm2 = new Pm2();
  /** 让 Vite 配置消费开发隧道和构建发布场景。 */
  public readonly vite = new Vite();
  /** 让 WebRTC 业务取得并保障信令与 STUN 数据。 */
  public readonly webrtcProxy = new WebrtcProxy();
}

export default new Ubuntu();
