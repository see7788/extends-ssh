import Vite from "./Vite/index.ts";
import WebrtcProxy from "./WebrtcProxy/index.ts";
import Pm2 from "./Pm2.ts";
import Services from "./Service/index.ts";

class Ubuntu {
  /** 让具体服务登记发布定义并取得自动保障生命周期。 */
  public readonly services = new Services();
  /** 让具体业务取得并维护远程 PM2 进程数据。 */
  public readonly pm2 = new Pm2();
  /** 让 Vite 配置消费开发隧道和构建发布场景。 */
  public readonly vite = new Vite();
  /** 让 WebRTC 业务取得并保障信令与 STUN 数据。 */
  public readonly webrtcProxy = new WebrtcProxy(this.services);
}

export default new Ubuntu();
