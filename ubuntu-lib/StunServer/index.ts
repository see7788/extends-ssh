import Base from "../public/index.ts";
import dgram from "node:dgram";
import { randomBytes } from "node:crypto";
import Docker from "../docker/index.ts";
import Ssh from "../ssh/index.ts";
import store from "../store/index.ts";

export default class extends Base {
  get port(): number {
    return store.getState().stunServer.port;
  }
  protected async setup(): Promise<void> {
    const docker = new Docker();
    const ssh = new Ssh();
    const { stunServer } = store.getState();
    const container = ssh.quoteShellArg(stunServer.containerName);
    const image = ssh.quoteShellArg(stunServer.image);
    const restartPolicy = ssh.quoteShellArg(stunServer.restartPolicy);
    const mode = ssh.quoteShellArg(stunServer.mode);
    const { host } = await ssh.config();
    if (!Number.isInteger(stunServer.port) || stunServer.port < 1 || stunServer.port > 65_535) {
      throw new Error(`STUN 端口必须是 1-65535 的整数: ${String(stunServer.port)}`);
    }
    const { port: sshPort } = await ssh.config();
    if (stunServer.port === sshPort || stunServer.port === 80 || stunServer.port === 443) {
      throw new Error(`STUN 端口与固定服务端口冲突: ${String(stunServer.port)}`);
    }
    const state = { host, port: stunServer.port };
    await docker.setupReady();
    const occupancy = await ssh.execute(`if docker inspect ${container} >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' ${container})" = true ]; then printf own; elif ss -ltnH | awk '$4 ~ /(^|:)${state.port}$/ { found=1 } END { exit !found }' || ss -lunH | awk '$4 ~ /(^|:)${state.port}$/ { found=1 } END { exit !found }'; then printf occupied; else printf free; fi`);
    if (occupancy.stdout.trim() === "occupied") {
      throw new Error(`STUN 端口已被远程服务占用: ${String(state.port)}`);
    }
    await ssh.execute(`
set -e
docker info >/dev/null
if docker inspect ${container} >/dev/null 2>&1; then
  docker start ${container} >/dev/null
else
  docker pull ${image}
  docker run -d --restart=${restartPolicy} --name ${container} \
    -p ${state.port}:${state.port}/tcp \
    -p ${state.port}:${state.port}/udp \
    ${image} --${mode} --listening-port=${state.port}
fi
ufw allow ${state.port}/tcp >/dev/null
ufw allow ${state.port}/udp >/dev/null
ufw reload >/dev/null
test "$(docker inspect -f '{{.State.Running}}' ${container})" = true
ss -lun | grep -Eq ':${state.port}[[:space:]]'
`);
    await this.bindingRequest(state.host, state.port);
  }

  async update(): Promise<void> {
    const ssh = new Ssh();
    const { stunServer } = store.getState();
    const { host, port: sshPort } = await ssh.config();
    if (!Number.isInteger(stunServer.port) || stunServer.port < 1 || stunServer.port > 65_535) {
      throw new Error(`STUN 端口必须是 1-65535 的整数: ${String(stunServer.port)}`);
    }
    if (stunServer.port === sshPort || stunServer.port === 80 || stunServer.port === 443) {
      throw new Error(`STUN 端口与固定服务端口冲突: ${String(stunServer.port)}`);
    }
    const container = ssh.quoteShellArg(stunServer.containerName);
    const image = ssh.quoteShellArg(stunServer.image);
    const restartPolicy = ssh.quoteShellArg(stunServer.restartPolicy);
    const mode = ssh.quoteShellArg(stunServer.mode);
    await new Docker().setupReady();
    await ssh.execute(`set -e
if docker inspect ${container} >/dev/null 2>&1; then docker rm -f ${container} >/dev/null; fi
docker pull ${image}
docker run -d --restart=${restartPolicy} --name ${container} \\
  -p ${stunServer.port}:${stunServer.port}/tcp -p ${stunServer.port}:${stunServer.port}/udp \\
  ${image} --${mode} --listening-port=${stunServer.port}
ufw allow ${stunServer.port}/tcp >/dev/null
ufw allow ${stunServer.port}/udp >/dev/null
ufw reload >/dev/null
test "$(docker inspect -f '{{.State.Running}}' ${container})" = true`);
    await this.bindingRequest(host, stunServer.port);
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
