import Base from "../public/index.ts";
import Docker from "../docker/index.ts";
import Ssh from "../ssh/index.ts";
import StunServer from "../stunServer/index.ts";
import Vite from "../ports/index.ts";
import type { PeerOptions } from "peerjs";
import type { Plugin } from "vite";

export default class extends Base {
  async setup(): Promise<void> {
    const docker = new Docker();
    const ssh = new Ssh();
    const { host } = await ssh.config();
    const { imageName, packageVersion } = this.envs.peerjs;
    const { containerName, key, listenPort, pathname } = this.envs.peerjs;
    const image = `${imageName}:${packageVersion}`;
    const configuration = `${image}|${listenPort}|${pathname}|${key}`;
    await docker.setupReady();
    await ssh.execute(`
set -e
docker info >/dev/null
if docker inspect ${ssh.quoteShellArg(containerName)} >/dev/null 2>&1; then
  CURRENT_CONFIGURATION="$(docker inspect -f '{{ index .Config.Labels "extends-ssh.peerjs.configuration" }}' ${ssh.quoteShellArg(containerName)})"
  if [ "$CURRENT_CONFIGURATION" != ${ssh.quoteShellArg(configuration)} ]; then
    docker rm -f ${ssh.quoteShellArg(containerName)} >/dev/null
  fi
fi
if ! docker inspect ${ssh.quoteShellArg(containerName)} >/dev/null 2>&1; then
  docker pull ${ssh.quoteShellArg(image)}
  docker run -d --restart=unless-stopped --name ${ssh.quoteShellArg(containerName)} \
    --label ${ssh.quoteShellArg(`extends-ssh.peerjs.configuration=${configuration}`)} \
    -p 0.0.0.0:${listenPort}:${listenPort} \
    ${ssh.quoteShellArg(image)} \
    --port ${listenPort} --path ${ssh.quoteShellArg(pathname)} \
    --key ${ssh.quoteShellArg(key)} --proxied >/dev/null
else
  docker start ${ssh.quoteShellArg(containerName)} >/dev/null
fi
test "$(docker inspect -f '{{.State.Running}}' ${ssh.quoteShellArg(containerName)})" = true
ufw allow ${listenPort}/tcp >/dev/null
ufw reload >/dev/null
for attempt in $(seq 1 40); do
  if curl --fail --silent ${ssh.quoteShellArg(`http://127.0.0.1:${listenPort}${pathname}`)} \
    | grep -q 'PeerJS'; then
    exit 0
  fi
  sleep 0.25
done
docker logs --tail 40 ${ssh.quoteShellArg(containerName)} >&2 || true
exit 1
`);
    const health = await fetch(
      `http://${host}:${listenPort}${pathname}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!health.ok) {
      throw new Error(`PeerJS 连接健康检查失败: HTTP ${health.status}`);
    }
  }

  get endpoint(): PeerOptions {
    const { key, listenPort, pathname } = this.envs.peerjs;
    const ssh = new Ssh();
    const stunServer = new StunServer();
    return {
      host: ssh.host,
      port: listenPort,
      path: pathname,
      secure: false as const,
      key,
      config: {
        iceServers: [{ urls: `stun:${ssh.host}:${stunServer.port}` }],
      },
    };
  }

  vitePlugin(devPort: number): Plugin {
    const vite = new Vite(devPort);
    return {
      name: `peerjsPlugin${devPort}`,
      enforce: "pre",
      configResolved: async () => {
        vite.mergeState({ peerjs: this.endpoint });
      },
      configureServer: async () => {
        const stunServer = new StunServer();
        await this.setupReady();
        await stunServer.setupReady();
      },
    };
  }
}
