import dgram from "node:dgram";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import Public from "extends-ssh/Ubuntu/public.ts";
import store from "extends-ssh/Ubuntu/store.ts";

export default class WebrtcProxy {
  private readonly runtime = new Public();

  /** 交付 WebRTC Proxy 直接消费的信令与 STUN 连接数据。 */
  public get state() {
    const { ssh, webrtcProxy } = store.getState();
    for (const port of [
      webrtcProxy.peerServer.port,
      webrtcProxy.stunServer.port,
    ]) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`WebRTC 端口必须是 1-65535 的整数: ${String(port)}`);
      }
    }
    if (!/^\/[A-Za-z0-9/_-]*$/.test(webrtcProxy.peerServer.path)) {
      throw new Error(`WebRTC 信令路径无效: ${webrtcProxy.peerServer.path}`);
    }
    return {
      peerServer: {
        host: ssh.host,
        port: webrtcProxy.peerServer.port,
        path: webrtcProxy.peerServer.path,
        secure: false as const,
      },
      stunServer: {
        host: ssh.host,
        port: webrtcProxy.stunServer.port,
        secure: false as const,
      },
    };
  }

  /** 发布并验证公网 HTTP、WebSocket 信令与 STUN 服务。 */
  public async isRunning(): Promise<typeof this.state> {
    const packageJson = createRequire(import.meta.url).resolve("webrtcsignaling/package.json");
    const packageRoot = path.dirname(packageJson);
    execFileSync("pnpm", ["build"], {
      cwd: packageRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: "pipe",
    });
    const localServer = path.resolve(packageRoot, "dist", "server.cjs");
    if (!existsSync(localServer)) throw new Error(`WebRTC 信令构建产物不存在: ${localServer}`);

    const { peerServer, stunServer } = this.state;
    const remotePath = "/www/wwwroot/extends-ssh/webrtcsignaling";
    try {
      await this.runtime.pm2IsRunning();
      await this.runtime.execute(`mkdir -p '${remotePath}'`);
      await this.runtime.ssh.putFile(localServer, `${remotePath}/server.cjs`);
      await this.runtime.execute(`
set -e
systemctl disable --now webrtcsignaling >/dev/null 2>&1 || true
pm2 delete webrtcsignaling >/dev/null 2>&1 || true
cd '${remotePath}'
WEBRTC_SIGNALING_HOSTNAME=0.0.0.0 \\
WEBRTC_SIGNALING_PORT=${peerServer.port} \\
WEBRTC_SIGNALING_PATH='${peerServer.path}' \\
pm2 start server.cjs --name webrtcsignaling --interpreter node
pm2 save --force >/dev/null

if ! docker info >/dev/null 2>&1; then
  echo '当前 WebRTC STUN 生产者要求远程 Docker daemon 可用' >&2
  exit 1
fi
if docker inspect coturn >/dev/null 2>&1; then
  docker start coturn >/dev/null
else
  docker pull coturn/coturn:latest
  docker run -d --restart=unless-stopped --name coturn \\
    -p ${stunServer.port}:${stunServer.port} \\
    -p ${stunServer.port}:${stunServer.port}/udp \\
    coturn/coturn:latest --stun-only --listening-port=${stunServer.port}
fi

ufw allow ${peerServer.port}/tcp >/dev/null
ufw allow ${stunServer.port}/tcp >/dev/null
ufw allow ${stunServer.port}/udp >/dev/null
ufw reload >/dev/null

for attempt in $(seq 1 20); do
  if curl --fail --silent 'http://127.0.0.1:${peerServer.port}/' \\
    | grep '"name":"webrtcsignaling"' >/dev/null; then break; fi
  sleep 0.25
done
curl --fail --silent 'http://127.0.0.1:${peerServer.port}/' \\
  | grep '"name":"webrtcsignaling"' >/dev/null
test "$(docker inspect -f '{{.State.Running}}' coturn)" = true
ss -lun | grep -q ':${stunServer.port} '
`);
    } finally {
      this.runtime.dispose();
    }

    const health = await fetch(`http://${peerServer.host}:${peerServer.port}/`, {
      signal: AbortSignal.timeout(10_000),
    });
    const healthState = await health.json() as { name?: string };
    if (!health.ok || healthState.name !== "webrtcsignaling") {
      throw new Error(`WebRTC 信令公网健康检查失败: HTTP ${health.status}`);
    }

    const peerId = `extends-ssh-${Date.now()}`;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://${peerServer.host}:${peerServer.port}${peerServer.path}?peerId=${peerId}`,
      );
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("WebRTC 信令公网 WebSocket 握手超时"));
      }, 5_000);
      socket.addEventListener("message", event => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; peerId?: string };
          if (message.type !== "open" || message.peerId !== peerId) return;
          clearTimeout(timeout);
          socket.close();
          resolve();
        } catch (error) {
          clearTimeout(timeout);
          socket.close();
          reject(error);
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("WebRTC 信令公网 WebSocket 握手失败"));
      });
    });

    await new Promise<void>((resolve, reject) => {
      const socket = dgram.createSocket("udp4");
      const request = Buffer.concat([
        Buffer.from([0x00, 0x01, 0x00, 0x00, 0x21, 0x12, 0xa4, 0x42]),
        randomBytes(12),
      ]);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("WebRTC STUN 公网响应超时"));
      }, 5_000);
      socket.once("error", error => {
        clearTimeout(timeout);
        socket.close();
        reject(error);
      });
      socket.once("message", response => {
        clearTimeout(timeout);
        socket.close();
        if (
          response.length < 20
          || response.readUInt16BE(0) !== 0x0101
          || !response.subarray(8, 20).equals(request.subarray(8, 20))
        ) {
          reject(new Error("WebRTC STUN 公网响应无效"));
          return;
        }
        resolve();
      });
      socket.send(request, stunServer.port, stunServer.host, error => {
        if (!error) return;
        clearTimeout(timeout);
        socket.close();
        reject(error);
      });
    });

    return this.state;
  }
}
