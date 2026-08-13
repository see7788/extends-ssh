import Forward from "./Forward/index.ts";
import StunServer from "./StunServer/index.ts";
import Vite from "./Vite/index.ts";
import Webrtcsignaling from "./Webrtcsignaling/index.ts";
import Pm2 from "./Pm2.ts";
import Public from "./public.ts";

class Ubuntu {
  private readonly runtime = new Public();

  /** 注册并维护本地、远端端点组成的 SSH 转发。 */
  public readonly forward = new Forward();
  /** 让具体业务取得并维护远程 PM2 进程数据。 */
  public readonly pm2 = new Pm2();
  /** 交付本地与远端之间的 SFTP 文件传输能力。 */
  public readonly sftp = this.runtime.sftp;
  /** 交付 STUN 连接数据并确保 Coturn 服务可用。 */
  public readonly stunServer = new StunServer();
  /** 让 Vite 配置消费开发隧道和构建发布场景。 */
  public readonly vite = new Vite(this.forward);
  /** 交付 WebRTC 信令连接数据并确保信令服务可用。 */
  public readonly webrtcsignaling = new Webrtcsignaling();
}

export default new Ubuntu();
