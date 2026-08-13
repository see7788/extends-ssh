import type ForwardRemote from "../ForwardRemote/index.ts";
import store from "../store.ts";

export default class WebrtcProxy {
  private runningPromise?: Promise<typeof this.state>;

  constructor(private readonly forwardRemote: ForwardRemote) {}

  public get state() {
    const { ssh, webrtcProxy } = store.getState();
    if (!Number.isInteger(webrtcProxy.port) || webrtcProxy.port < 1 || webrtcProxy.port > 65_535) {
      throw new Error(`WebRTC 信令端口必须是 1-65535 的整数: ${String(webrtcProxy.port)}`);
    }
    if (!/^\/[A-Za-z0-9/_-]*$/.test(webrtcProxy.path)) {
      throw new Error(`WebRTC 信令路径无效: ${webrtcProxy.path}`);
    }
    return {
      host: ssh.host,
      port: webrtcProxy.port,
      path: webrtcProxy.path,
      secure: false as const,
    };
  }

  public isRunning(): Promise<typeof this.state> {
    if (this.runningPromise) return this.runningPromise;
    this.runningPromise = this.runningEnsure().finally(() => {
      this.runningPromise = undefined;
    });
    return this.runningPromise;
  }

  private async runningEnsure(): Promise<typeof this.state> {
    await this.forwardRemote.isRunning();
    const state = this.state;
    const origin = `${state.secure ? "https" : "http"}://${state.host}:${state.port}`;
    const health = await fetch(`${origin}/`, {
      signal: AbortSignal.timeout(10_000),
    });
    const healthState = await health.json() as { name?: string };
    if (!health.ok || healthState.name !== "webrtcsignaling") {
      throw new Error(`WebRTC 信令公网健康检查失败: HTTP ${health.status}`);
    }

    const tokenUrl = `${origin}${state.path}/ubuntu-lib-health/connect`;
    const connectionResponse = await fetch(tokenUrl, {
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
      connectionResponse.url || tokenUrl,
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
        socket.close();
        reject(new Error("WebRTC 信令公网 WebSocket 握手失败"));
      });
    });

    return this.state;
  }
}
