import nginx from "../Nginx/index.ts";
import publicRuntime from "../Public/index.ts";
import store from "../store.ts";
import vitePlugin from "./vitePlugin.ts";

class Webrtcsignaling {
  private remoteRunningPromise?: Promise<void>;

  public get state() {
    const { pathname } = store.getState().webrtcsignaling;
    return {
      host: `webrtc.${nginx.state.domain}`,
      port: nginx.state.httpsPort,
      path: pathname,
      secure: nginx.state.secure,
    };
  }

  public isRemoteRunning(): Promise<void> {
    if (this.remoteRunningPromise) return this.remoteRunningPromise;
    const remoteRunningPromise = this.remoteRunningEnsure().finally(() => {
      if (this.remoteRunningPromise === remoteRunningPromise) {
        this.remoteRunningPromise = undefined;
      }
    });
    this.remoteRunningPromise = remoteRunningPromise;
    return remoteRunningPromise;
  }

  public vitePlugin(options: { entry: string } | { projectName: string }) {
    return vitePlugin(this, options);
  }

  private async remoteRunningEnsure(): Promise<void> {
    const { entry, path, pathname, listenPort } = store.getState().webrtcsignaling;
    if (!path || !entry) throw new Error("WebRTC 信令外部实现尚未报备源码目录和入口");

    await publicRuntime.serviceIsRunning({
      name: "webrtcsignaling",
      entry,
      path,
      environment: {
        WS_NO_BUFFER_UTIL: "1",
        WS_NO_UTF_8_VALIDATE: "1",
        WEBRTC_SIGNALING_HOSTNAME: "127.0.0.1",
        WEBRTC_SIGNALING_PATH: pathname,
        WEBRTC_SIGNALING_PORT: String(listenPort),
      },
      healthCommand:
        `curl --fail --silent http://127.0.0.1:${listenPort}${pathname} | grep '"name":"webrtcsignaling"'`,
    });

    const state = this.state;
    await nginx.proxyRouteIsRunning({
      name: "webrtcsignaling",
      hostname: state.host,
      pathname: state.path,
      upstreamPort: listenPort,
    });

    const healthUrl = `https://${state.host}${state.path}`;
    const health = await fetch(healthUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    const healthState = await health.json() as { name?: unknown };
    if (!health.ok || healthState.name !== "webrtcsignaling") {
      throw new Error(`WebRTC 信令公网健康检查失败: HTTP ${health.status}`);
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        `wss://${state.host}${state.path}/ubuntu-lib-health`,
      );
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("WebRTC 信令公网 WebSocket 握手超时"));
      }, 5_000);
      socket.addEventListener("message", event => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: unknown;
            peerId?: unknown;
            projectName?: unknown;
          };
          if (
            message.type !== "open"
            || typeof message.peerId !== "string"
            || message.projectName !== "ubuntu-lib-health"
          ) return;
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

export default new Webrtcsignaling();
