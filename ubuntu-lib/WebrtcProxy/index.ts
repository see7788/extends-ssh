import Public from "../public.ts";
import store from "../store.ts";
import { dirname, resolve } from "node:path";

const serviceName = "webrtcsignaling";

export default class WebrtcProxy {
  private readonly runtime = new Public();
  private remoteRunningPromise?: Promise<void>;

  public get state() {
    const { ssh, webrtcProxy } = store.getState();
    const pathname = webrtcProxy.pathname
      || (webrtcProxy.path.startsWith("/") ? webrtcProxy.path : "/signal");
    if (!Number.isInteger(webrtcProxy.port) || webrtcProxy.port < 1 || webrtcProxy.port > 65_535) {
      throw new Error(`WebRTC 信令端口必须是 1-65535 的整数: ${String(webrtcProxy.port)}`);
    }
    if (!/^\/[A-Za-z0-9/_-]*$/.test(pathname)) {
      throw new Error(`WebRTC 信令路径无效: ${pathname}`);
    }
    return {
      host: ssh.host,
      port: webrtcProxy.port,
      path: pathname,
      secure: false as const,
    };
  }

  public isRemoteRunning(): Promise<void> {
    if (this.remoteRunningPromise) return this.remoteRunningPromise;
    this.remoteRunningPromise = this.remoteRunningEnsure().finally(() => {
      this.remoteRunningPromise = undefined;
      this.runtime.dispose();
    });
    return this.remoteRunningPromise;
  }

  /** 从 Vite 的真实构建输出报备信令产物，并在构建结束后提交服务。 */
  public vite(jwtSecret: string) {
    if (!jwtSecret.trim()) {
      throw new TypeError("WebRTC 信令 JWT secret 不能为空");
    }
    let projectRoot = process.cwd();
    let artifactPath: string | undefined;
    return {
      name: "ubuntu-lib:webrtcProxy",
      apply: "build" as const,
      enforce: "post" as const,
      configResolved: (config: { root: string }) => {
        projectRoot = config.root;
      },
      writeBundle: (
        output: { dir?: string; file?: string },
        bundle: Record<string, {
          type: string;
          fileName: string;
          isEntry?: boolean;
        }>,
      ) => {
        const entries = Object.values(bundle).filter(
          item => item.type === "chunk" && item.isEntry,
        );
        if (entries.length !== 1) {
          throw new Error(`WebRTC 信令构建必须产生唯一入口，当前为 ${entries.length} 个`);
        }
        const outputDirectory = output.dir
          ? resolve(projectRoot, output.dir)
          : output.file
            ? dirname(resolve(projectRoot, output.file))
            : undefined;
        if (!outputDirectory) {
          throw new Error("WebRTC 信令构建未提供输出目录");
        }
        artifactPath = resolve(outputDirectory, entries[0].fileName);
      },
      closeBundle: async () => {
        if (!artifactPath) {
          throw new Error("WebRTC 信令构建未产生可报备的入口文件");
        }
        store.getState().webrtcProxyActions.register({
          path: artifactPath,
          jwtSecret,
        });
        await this.isRemoteRunning();
      },
    };
  }

  private async remoteRunningEnsure(): Promise<void> {
    const { ssh, stunServer, webrtcProxy } = store.getState();
    if (!webrtcProxy.path) {
      throw new Error("WebRTC 信令外部实现尚未报备产物路径");
    }
    if (!webrtcProxy.jwtSecret) {
      throw new Error("WebRTC 信令外部实现尚未报备 JWT secret");
    }
    if (!Number.isInteger(stunServer.port) || stunServer.port < 1 || stunServer.port > 65_535) {
      throw new Error(`STUN 端口必须是 1-65535 的整数: ${String(stunServer.port)}`);
    }
    const state = this.state;
    await this.runtime.serviceIsRunning({
      name: serviceName,
      path: webrtcProxy.path,
      environment: {
        WS_NO_BUFFER_UTIL: "1",
        WS_NO_UTF_8_VALIDATE: "1",
        WEBRTC_RTC_CONFIGURATION: JSON.stringify({
          iceServers: [{ urls: `stun:${ssh.host}:${stunServer.port}` }],
        }),
        WEBRTC_SIGNALING_HOSTNAME: "0.0.0.0",
        WEBRTC_SIGNALING_JWT_SECRET: webrtcProxy.jwtSecret,
        WEBRTC_SIGNALING_PATH: state.path,
        WEBRTC_SIGNALING_PORT: String(state.port),
        WEBRTC_SIGNALING_TOKEN_TTL_SECONDS: "300",
      },
      healthCommand:
        `curl --fail --silent http://127.0.0.1:${state.port}/ | grep '"name":"${serviceName}"'`,
    });
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

  }
}
