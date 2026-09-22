import Base from "./Base.ts";
import type { Plugin } from "vite";
import { z } from "zod";
import { nginx } from "../nginx/index.ts";
import { peerjs } from "../peerjs/index.ts";
import { pm2 } from "../pm2/index.ts";
import { sftp } from "../sftp/index.ts";
import { sshForward } from "../sshForward/index.ts";
import { stunServer } from "../stunServer/index.ts";
import store from "../store/index.ts";

type Pm2Input = Omit<Parameters<typeof pm2.makeRemote>[0], "port">;

const devPortValidator = z.number().int().min(1).max(65_535);

export class ServerBase extends Base {
  protected readonly devPort: z.infer<typeof devPortValidator>;
  protected projectPath = "";
  readonly plugin: Plugin[] = [];

  constructor(devPort: number) {
    super();
    this.devPort = devPort;
    this.plugin.push({
      name: "baseserver" + this.devPort + ":register",
      config: () => ({
        server: {
          port: this.devPort,
          strictPort: true,
        },
      }),
      configResolved: config => {
        this.projectPath = config.root;
      },
    });
  }

  // 远程应用进程：<ssh-host>:${devPort}（由应用命令监听）
  addPm2(input: Pm2Input): this {
    this.plugin.push({
      name: "baseserver" + this.devPort + ":pm2",
      closeBundle: async () => {
        await pm2.makeRemote({ ...input, port: this.devPort });
      },
    });
    return this;
  }

  // 远程文件路径：<remoteRoot>/<devPort>
  addSftp(): this {
    this.plugin.push({
      name: "baseserver" + this.devPort + ":sftp",
      closeBundle: async () => {
        if (!this.projectPath) throw new Error("Vite 项目根目录尚未解析");
        await sftp.makeRemote({ port: this.devPort, localPath: this.projectPath });
      },
    });
    return this;
  }

  // SSH 端口转发：<ssh-host>:${devPort}
  addSshForward(): this {
    this.plugin.push({
      name: "baseserver" + this.devPort + ":ssh-forward",
      configureServer: async () => {
        await sshForward.makeRemote(this.devPort);
      },
      closeBundle: async () => {
        await sshForward.closeRemote(this.devPort);
      },
    });
    return this;
  }

  // Nginx 端口反向代理：https://${devPort}.<domain>（需 DNS 指向 SSH 主机）
  addNginxPort(): this {
    this.plugin.push({
      name: "baseserver" + this.devPort + ":nginx",
      configureServer: async () => {
        await nginx.makePortRemote(this.devPort);
      },
      closeBundle: async () => {
        await nginx.closeRemote(this.devPort);
      },
    });
    return this;
  }

  // Nginx 静态路径：https://${devPort}.<domain>（根目录为 <remoteRoot>/<devPort>）
  addNginxPath(): this {
    this.plugin.push({
      name: "baseserver" + this.devPort + ":nginx-path",
      closeBundle: async () => {
        const remote = await sftp.getRemote(this.devPort);
        await nginx.makePathRemote(remote.path);
      },
    });
    return this;
  }

  // PeerJS 直连地址：http://<ssh-host>:<listenPort><pathname>
  addPeerjs(): this {
    this.plugin.push({
      name: "baseserver" + this.devPort + ":peerjs",
      config: async () => {
        await peerjs.remoteIsRunning();
        const { peerjs: peerjsState, ssh: sshState } = store.getState();
        return {
          define: {
            "globalThis.WEBRTC_PEERJS": JSON.stringify({
              host: sshState.host,
              port: peerjsState.listenPort,
              path: peerjsState.pathname,
              secure: false,
              key: peerjsState.key,
            }),
          },
        };
      },
    });
    return this;
  }

  // STUN 地址：stun:<ssh-host>:<stun-port>
  addStunServer(): this {
    this.plugin.push({
      name: "baseserver" + this.devPort + ":stun-server",
      config: async () => {
        await stunServer.remoteIsRunning();
        const { ssh, stunServer: stunState } = store.getState();
        return {
          define: {
            "globalThis.WEBRTC_STUN_URL": JSON.stringify(`stun:${ssh.host}:${stunState.port}`),
          },
        };
      },
    });
    return this;
  }
}
