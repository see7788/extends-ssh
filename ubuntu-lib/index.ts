import Apt from "./Apt/index.ts";
import Docker from "./Docker/index.ts";
import Forward from "./Forward/index.ts";
import Nginx from "./Nginx/index.ts";
import Nodejs from "./Nodejs/index.ts";
import Peerjs from "./Peerjs/index.ts";
import Pm2 from "./Pm2/index.ts";
import Sftp from "./Sftp/index.ts";
import Ssh from "./Ssh/index.ts";
import StunServer from "./StunServer/index.ts";
import Vite from "./Vite/index.ts";
import Webrtcsignaling from "./Webrtcsignaling/index.ts";
import store from "./store.ts";

const ssh = new Ssh();

class AptRuntime extends Apt {
  protected readonly ssh = ssh;
}
const apt = new AptRuntime();

class NodejsRuntime extends Nodejs {
  protected readonly apt = apt;
  protected readonly ssh = ssh;
}
const nodejs = new NodejsRuntime();

class DockerRuntime extends Docker {
  protected readonly apt = apt;
  protected readonly ssh = ssh;
}
const docker = new DockerRuntime();

class SftpRuntime extends Sftp {
  protected readonly ssh = ssh;
}
const sftp = new SftpRuntime();

class Pm2Runtime extends Pm2 {
  protected readonly nodejs = nodejs;
  protected readonly ssh = ssh;
}
const pm2 = new Pm2Runtime();

class ForwardRuntime extends Forward {
  protected readonly ssh = ssh;
}
const forward = new ForwardRuntime();

class NginxRuntime extends Nginx {
  protected readonly apt = apt;
  protected readonly ssh = ssh;
}
const nginx = new NginxRuntime();

class PeerjsRuntime extends Peerjs {
  protected readonly docker = docker;
  protected readonly nginx = nginx;
  protected readonly ssh = ssh;
}
const peerjs = new PeerjsRuntime();

class StunServerRuntime extends StunServer {
  protected readonly docker = docker;
  protected readonly ssh = ssh;
}
const stunServer = new StunServerRuntime();

class ViteRuntime extends Vite {
  protected readonly apt = apt;
  protected readonly forward = forward;
  protected readonly nginx = nginx;
  protected readonly pm2 = pm2;
  protected readonly sftp = sftp;
  protected readonly ssh = ssh;
}
const vite = new ViteRuntime();

class WebrtcsignalingRuntime extends Webrtcsignaling {
  protected readonly nginx = nginx;
  protected readonly pm2 = pm2;
  protected readonly sftp = sftp;
  protected readonly ssh = ssh;
}
const webrtcsignaling = new WebrtcsignalingRuntime();

class Ubuntu {
  /** 交付公共域名与远端根目录配置。 */
  public get public() {
    const { domain, remoteRoot } = store.getState().public;
    return { domain, remoteRoot };
  }
  /** 保障远端 Ubuntu 基础软件包与命令可用。 */
  public readonly apt = apt;
  /** 保障远端 Docker daemon 可用。 */
  public readonly docker = docker;
  /** 交付并保障固定版本的远端 Node.js。 */
  public readonly nodejs = nodejs;
  /** 交付 SSH 连接配置、会话与远程命令能力。 */
  public readonly ssh = ssh;
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
