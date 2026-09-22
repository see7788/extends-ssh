import Base from "../public/Base.ts";
import dgram from "node:dgram";
import { randomBytes } from "node:crypto";
import { docker } from "../docker/index.ts";
import mcpserver from "mcpserver";
import { ssh } from "../ssh/index.ts";
import store from "../store/index.ts";

class StunServer extends Base {
  async remoteIsRunning(): Promise<void> {
      const { ssh: sshState, stunServer } = store.getState();
      if (!Number.isInteger(stunServer.port) || stunServer.port < 1 || stunServer.port > 65_535) {
        throw new Error(`STUN 端口必须是 1-65535 的整数: ${String(stunServer.port)}`);
      }
      if (stunServer.port === sshState.port || stunServer.port === 80 || stunServer.port === 443) {
        throw new Error(`STUN 端口与固定服务端口冲突: ${String(stunServer.port)}`);
      }
      const state = { host: sshState.host, port: stunServer.port };
      await docker.remoteIsRunning();
      const occupancy = await ssh.execute(`if docker inspect coturn >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' coturn)" = true ]; then printf own; elif ss -ltnH | awk '$4 ~ /(^|:)${state.port}$/ { found=1 } END { exit !found }' || ss -lunH | awk '$4 ~ /(^|:)${state.port}$/ { found=1 } END { exit !found }'; then printf occupied; else printf free; fi`);
      if (occupancy.stdout.trim() === "occupied") {
        throw new Error(`STUN 端口已被远程服务占用: ${String(state.port)}`);
      }
      await ssh.execute(`
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

export const stunServer = new StunServer();

export default mcpserver.metas("/stunServer")
  .add({
    protocol: "tool",
    path: "/state",
    description: "读取 STUN 连接配置，不表示服务已就绪。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: input => {
      const { ssh, stunServer } = store.getState();
      return { host: ssh.host, port: stunServer.port, secure: false as const };
    },
  })
  .add({
    protocol: "tool",
    path: "/ensure",
    description: "检查并确保远端 STUN 服务处于可用状态。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      await stunServer.remoteIsRunning();
      return { ready: true };
    },
  });





