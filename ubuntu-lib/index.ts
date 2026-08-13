import forward from "./Forward/index.ts";
import nginx from "./Nginx/index.ts";
import peerjs from "./Peerjs/index.ts";
import pm2 from "./Pm2/index.ts";
import publicRuntime from "./Public/index.ts";
import sftp from "./Sftp/index.ts";
import stunServer from "./StunServer/index.ts";
import vite from "./Vite/index.ts";
import webrtcsignaling from "./Webrtcsignaling/index.ts";

class Ubuntu {
  /** 交付公共 SSH 会话与远程命令能力。 */
  public readonly public = publicRuntime;
  /** 交付域名数据，并维护远端 HTTPS、静态与反向代理路由。 */
  public readonly nginx = nginx;

  /** 注册并维护本地、远端端点组成的 SSH 转发。 */
  public readonly forward = forward;
  /** 确保远端 PM2 daemon 与开机启动配置可用。 */
  public readonly pm2 = pm2;
  /** 交付 PeerJS 连接数据并确保公共信令服务可用。 */
  public readonly peerjs = peerjs;
  /** 交付本地与远端之间的 SFTP 文件传输能力。 */
  public readonly sftp = sftp;
  /** 交付 STUN 连接数据并确保 Coturn 服务可用。 */
  public readonly stunServer = stunServer;
  /** 让 Vite 配置消费开发隧道和构建发布场景。 */
  public readonly vite = vite;
  /** 交付 WebRTC 信令连接数据并确保信令服务可用。 */
  public readonly webrtcsignaling = webrtcsignaling;
}

export default new Ubuntu();
