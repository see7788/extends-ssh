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

class AptRuntime extends Apt {
  constructor(protected readonly ssh: Ssh) {
    super();
  }
}

class NodejsRuntime extends Nodejs {
  constructor(
    protected readonly apt: Apt,
    protected readonly ssh: Ssh,
  ) {
    super();
  }
}

class DockerRuntime extends Docker {
  constructor(
    protected readonly apt: Apt,
    protected readonly ssh: Ssh,
  ) {
    super();
  }
}

class SftpRuntime extends Sftp {
  constructor(protected readonly ssh: Ssh) {
    super();
  }
}

class Pm2Runtime extends Pm2 {
  constructor(
    protected readonly nodejs: Nodejs,
    protected readonly ssh: Ssh,
  ) {
    super();
  }
}

class ForwardRuntime extends Forward {
  constructor(protected readonly ssh: Ssh) {
    super();
  }
}

class NginxRuntime extends Nginx {
  constructor(
    protected readonly apt: Apt,
    protected readonly ssh: Ssh,
  ) {
    super();
  }
}

class PeerjsRuntime extends Peerjs {
  constructor(
    protected readonly docker: Docker,
    protected readonly nginx: Nginx,
    protected readonly ssh: Ssh,
  ) {
    super();
  }
}

class StunServerRuntime extends StunServer {
  constructor(
    protected readonly docker: Docker,
    protected readonly ssh: Ssh,
  ) {
    super();
  }
}

class ViteRuntime extends Vite {
  constructor(
    protected readonly forward: Forward,
    protected readonly nginx: Nginx,
    protected readonly nodejs: Nodejs,
    protected readonly pm2: Pm2,
    protected readonly sftp: Sftp,
  ) {
    super();
  }
}

class WebrtcsignalingRuntime extends Webrtcsignaling {
  constructor(
    protected readonly nginx: Nginx,
    protected readonly pm2: Pm2,
    protected readonly sftp: Sftp,
    protected readonly ssh: Ssh,
  ) {
    super();
  }
}

class Ubuntu {
  /** 交付 SSH 连接配置、会话与远程命令能力。 */
  public readonly ssh = new Ssh();
  /** 保障远端 Ubuntu 基础软件包与命令可用。 */
  public readonly apt = new AptRuntime(this.ssh);
  /** 交付并保障固定版本的远端 Node.js。 */
  public readonly nodejs = new NodejsRuntime(this.apt, this.ssh);
  /** 保障远端 Docker daemon 可用。 */
  public readonly docker = new DockerRuntime(this.apt, this.ssh);
  /** 交付本地与远端之间的 SFTP 文件传输能力。 */
  public readonly sftp = new SftpRuntime(this.ssh);
  /** 确保远端 PM2 daemon 与开机启动配置可用。 */
  public readonly pm2 = new Pm2Runtime(this.nodejs, this.ssh);
  /** 注册并维护本地、远端端点组成的 SSH 转发。 */
  public readonly forward = new ForwardRuntime(this.ssh);
  /** 交付域名数据，并维护远端 HTTPS、静态与反向代理路由。 */
  public readonly nginx = new NginxRuntime(this.apt, this.ssh);
  /** 交付 PeerJS 连接数据并确保公共信令服务可用。 */
  public readonly peerjs = new PeerjsRuntime(this.docker, this.nginx, this.ssh);
  /** 交付 STUN 连接数据并确保 Coturn 服务可用。 */
  public readonly stunServer = new StunServerRuntime(this.docker, this.ssh);
  /** 让 Vite 配置消费开发隧道和构建发布场景。 */
  public readonly vite = new ViteRuntime(
    this.forward,
    this.nginx,
    this.nodejs,
    this.pm2,
    this.sftp,
  );
  /** 交付 WebRTC 信令连接数据并确保信令服务可用。 */
  public readonly webrtcsignaling = new WebrtcsignalingRuntime(
    this.nginx,
    this.pm2,
    this.sftp,
    this.ssh,
  );

  /** 交付公共域名与远端根目录配置。 */
  public get public() {
    const { domain, remoteRoot } = store.getState().public;
    return { domain, remoteRoot };
  }
}

export default new Ubuntu();
