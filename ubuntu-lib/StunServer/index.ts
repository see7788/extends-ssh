import dgram from "node:dgram";
import { randomBytes } from "node:crypto";
import type Ssh from "../Ssh/index.ts";
import store from "../store.ts";

export default abstract class StunServer {
  protected abstract readonly ssh: Ssh;
  private remoteRunningPromise?: Promise<void>;

  public get state() {
    const { ssh, stunServer } = store.getState();
    if (!Number.isInteger(stunServer.port) || stunServer.port < 1 || stunServer.port > 65_535) {
      throw new Error(`STUN 端口必须是 1-65535 的整数: ${String(stunServer.port)}`);
    }
    return {
      host: ssh.host,
      port: stunServer.port,
      secure: false as const,
    };
  }

  public isRemoteRunning(): Promise<void> {
    if (this.remoteRunningPromise) return this.remoteRunningPromise;

    const executionPromise = (async () => {
      const state = this.state;
      await this.ssh.execute(`
set -e
docker info >/dev/null
if docker inspect coturn >/dev/null 2>&1; then
  docker start coturn >/dev/null
else
  docker pull coturn/coturn:latest
  docker run -d --restart=unless-stopped --name coturn \
    -p ${state.port}:${state.port}/tcp \
    -p ${state.port}:${state.port}/udp \
    coturn/coturn:latest --stun-only --listening-port=${state.port}
fi
ufw allow ${state.port}/tcp >/dev/null
ufw allow ${state.port}/udp >/dev/null
ufw reload >/dev/null
test "$(docker inspect -f '{{.State.Running}}' coturn)" = true
ss -lun | grep -Eq ':${state.port}[[:space:]]'
`);

      await this.bindingRequest(state.host, state.port);
    })();

    const remoteRunningPromise = executionPromise.finally(() => {
      if (this.remoteRunningPromise === remoteRunningPromise) {
        this.remoteRunningPromise = undefined;
      }
    });
    this.remoteRunningPromise = remoteRunningPromise;
    return remoteRunningPromise;
  }

  public vitePlugin() {
    const state = this.state;
    return {
      name: "ubuntu-lib:stunServer-consumer",
      config: () => ({
        define: {
          "globalThis.WEBRTC_STUN_URL": JSON.stringify(
            `stun:${state.host}:${state.port}`,
          ),
        },
      }),
    };
  }

  private bindingRequest(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const transactionId = randomBytes(12);
      const request = Buffer.alloc(20);
      request.writeUInt16BE(0x0001, 0);
      request.writeUInt16BE(0, 2);
      request.writeUInt32BE(0x2112a442, 4);
      transactionId.copy(request, 8);
      const socket = dgram.createSocket("udp4");
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.removeAllListeners();
        try {
          socket.close();
        } catch {
          // 同一终止路径可能已关闭 socket。
        }
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(() => {
        finish(new Error("STUN 请求超时"));
      }, 5_000);

      socket.once("error", finish);
      socket.once("message", response => {
        if (
          response.length < 20
          || response.readUInt16BE(0) !== 0x0101
          || !response.subarray(8, 20).equals(transactionId)
        ) {
          finish(new Error("STUN 响应无效"));
          return;
        }
        finish();
      });
      socket.send(request, port, host, error => {
        if (error) finish(error);
      });
    });
  }
}
