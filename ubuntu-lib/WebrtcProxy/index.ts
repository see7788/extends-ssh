import dgram from "node:dgram";
import { randomBytes } from "node:crypto";
import Public from "../public.ts";
import type Services from "../Service/index.ts";
import store from "../store.ts";

export default class WebrtcProxy {
  private readonly runtime = new Public();

  constructor(private readonly services: Services) {}

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

  /** 交付指定项目无需调用方补充参数的连接凭证颁发地址。 */
  public tokenUrl(projectName: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(projectName)) {
      throw new TypeError(`WebRTC 项目名称无效: ${projectName}`);
    }
    const { peerServer } = this.state;
    const origin = `${peerServer.secure ? "https" : "http"}://${peerServer.host}:${String(peerServer.port)}`;
    return `${origin}${peerServer.path}/${encodeURIComponent(projectName)}/connect`;
  }

  /** 发布并验证公网 HTTP、WebSocket 信令与 STUN 服务。 */
  public async isRunning(): Promise<typeof this.state> {
    await this.services.get("webrtcsignaling").isRunning();
    const { peerServer, stunServer } = this.state;
    try {
      await this.runtime.execute(`
set -e
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

    const connectionResponse = await fetch(this.tokenUrl("ubuntu-lib-health"), {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (!connectionResponse.ok) {
      throw new Error(`WebRTC 连接凭证颁发失败: HTTP ${connectionResponse.status}`);
    }
    const connection = await connectionResponse.json() as {
      peerId?: unknown;
      token?: unknown;
      signalingPath?: unknown;
    };
    if (
      typeof connection.peerId !== "string"
      || typeof connection.token !== "string"
      || typeof connection.signalingPath !== "string"
      || !connection.signalingPath.startsWith("/")
    ) {
      throw new Error("WebRTC 连接凭证格式无效");
    }
    const signalingUrl = new URL(
      connection.signalingPath,
      connectionResponse.url || this.tokenUrl("ubuntu-lib-health"),
    );
    if (signalingUrl.protocol === "http:") signalingUrl.protocol = "ws:";
    else if (signalingUrl.protocol === "https:") signalingUrl.protocol = "wss:";
    else throw new TypeError(`WebRTC 信令协议无效: ${signalingUrl.protocol}`);
    signalingUrl.searchParams.set("token", connection.token);

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(signalingUrl);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("WebRTC 信令公网 WebSocket 握手超时"));
      }, 5_000);
      socket.addEventListener("message", event => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; peerId?: string };
          if (message.type !== "open" || message.peerId !== connection.peerId) return;
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
