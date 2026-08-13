import Forward from "./Forward/index.ts";
import Nginx from "./Nginx/index.ts";
import Peerjs from "./Peerjs/index.ts";
import StunServer from "./StunServer/index.ts";
import Vite from "./Vite/index.ts";
import Webrtcsignaling from "./Webrtcsignaling/index.ts";
import Pm2 from "./Pm2/index.ts";
import Public from "./Public/index.ts";

class Ubuntu {
  /** 交付公共 SSH、SFTP、PM2 与远程 TypeScript 服务能力。 */
  public readonly public = new Public();
  /** 交付域名数据，并维护远端 HTTPS、静态与反向代理路由。 */
  public readonly nginx = new Nginx();

  /** 注册并维护本地、远端端点组成的 SSH 转发。 */
  public readonly forward = new Forward();
  /** 确保远端 PM2 daemon 与开机启动配置可用。 */
  public readonly pm2 = new Pm2();
  /** 交付 PeerJS 连接数据并确保公共信令服务可用。 */
  public readonly peerjs = new Peerjs(this.nginx);
  /** 交付本地与远端之间的 SFTP 文件传输能力。 */
  public readonly sftp = this.public.sftp;
  /** 交付 STUN 连接数据并确保 Coturn 服务可用。 */
  public readonly stunServer = new StunServer();
  /** 让 Vite 配置消费开发隧道和构建发布场景。 */
  public readonly vite = new Vite(this.forward, this.nginx);
  /** 交付 WebRTC 信令连接数据并确保信令服务可用。 */
  public readonly webrtcsignaling = new Webrtcsignaling(this.nginx);
}

export default new Ubuntu();
