import ForwardLoc from "./ForwardLoc/index.ts";
import ForwardRemote from "./ForwardRemote/index.ts";
import StunServer from "./StunServer/index.ts";
import Vite from "./Vite/index.ts";
import WebrtcProxy from "./WebrtcProxy/index.ts";
import Pm2 from "./Pm2.ts";

class Ubuntu {
  /** 确保本地端口通过 SSH 远端监听保持可访问。 */
  public readonly forwardLoc = new ForwardLoc();
  /** 确保远端服务按目标版本发布并健康运行。 */
  public readonly forwardRemote = new ForwardRemote();
  /** 让具体业务取得并维护远程 PM2 进程数据。 */
  public readonly pm2 = new Pm2();
  /** 交付 STUN 连接数据并确保 Coturn 服务可用。 */
  public readonly stunServer = new StunServer();
  /** 让 Vite 配置消费开发隧道和构建发布场景。 */
  public readonly vite = new Vite(this.forwardLoc);
  /** 交付 WebRTC 信令连接数据并确保信令服务可用。 */
  public readonly webrtcProxy = new WebrtcProxy(this.forwardRemote);
}

export default new Ubuntu();
