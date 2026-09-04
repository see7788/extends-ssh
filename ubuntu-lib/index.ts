import { apt } from "./Apt/index.ts";
import { docker } from "./Docker/index.ts";
import { forward } from "./Forward/index.ts";
import { nginx } from "./Nginx/index.ts";
import { nodejs } from "./Nodejs/index.ts";
import { peerjs } from "./Peerjs/index.ts";
import { pm2 } from "./Pm2/index.ts";
import { publicConfig } from "./Public/index.ts";
import { sftp } from "./Sftp/index.ts";
import { ssh } from "./Ssh/index.ts";
import { stunServer } from "./StunServer/index.ts";
import { vite } from "./Vite/index.ts";
import { webrtcsignaling } from "./Webrtcsignaling/index.ts";

class Ubuntu {
  /** 交付 SSH 连接配置、会话与远程命令能力。 */
  public readonly ssh = ssh;
  /** 保障远端 Ubuntu 基础软件包与命令可用。 */
  public readonly apt = apt;
  /** 交付并保障固定版本的远端 Node.js。 */
  public readonly nodejs = nodejs;
  /** 保障远端 Docker daemon 可用。 */
  public readonly docker = docker;
  /** 交付本地与远端之间的 SFTP 文件传输能力。 */
  public readonly sftp = sftp;
  /** 确保远端 PM2 daemon 与开机启动配置可用。 */
  public readonly pm2 = pm2;
  /** 注册并维护本地、远端端点组成的 SSH 转发。 */
  public readonly forward = forward;
  /** 交付域名数据，并维护远端 HTTPS、静态与反向代理路由。 */
  public readonly nginx = nginx;
  /** 交付 PeerJS 连接数据并确保公共信令服务可用。 */
  public readonly peerjs = peerjs;
  /** 交付 STUN 连接数据并确保 Coturn 服务可用。 */
  public readonly stunServer = stunServer;
  /** 让 Vite 配置按开发转发、生产静态交付和生产 Node.js 交付组合能力。 */
  public readonly vite = vite;
  /** 交付 WebRTC 信令连接数据并确保信令服务可用。 */
  public readonly webrtcsignaling = webrtcsignaling;

  /** 交付公共域名配置。 */
  public get public() {
    return publicConfig.state;
  }
}

export default new Ubuntu();
