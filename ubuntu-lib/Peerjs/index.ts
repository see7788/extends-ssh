import Base from "../public/index.ts";
import Docker from "../docker/index.ts";
import Ssh from "../ssh/index.ts";
import StunServer from "../stunServer/index.ts";
import store from "../store/index.ts";

export default class extends Base {
  protected async setup(): Promise<void> {
    const docker = new Docker();
    const ssh = new Ssh();
    const { peerjs } = store.getState();
    const { host } = await ssh.config();
    const { image, key, listenPort, pathname } = peerjs;
    const configuration = `${image}|${listenPort}|${pathname}|${key}`;
    await docker.setupReady();
    await ssh.execute(`
set -e
docker info >/dev/null
if docker inspect peerjs >/dev/null 2>&1; then
  CURRENT_CONFIGURATION="$(docker inspect -f '{{ index .Config.Labels "extends-ssh.peerjs.configuration" }}' peerjs)"
  if [ "$CURRENT_CONFIGURATION" != ${this.shell(configuration)} ]; then
    docker rm -f peerjs >/dev/null
  fi
fi
if ! docker inspect peerjs >/dev/null 2>&1; then
  docker pull ${this.shell(image)}
  docker run -d --restart=unless-stopped --name peerjs \
    --label ${this.shell(`extends-ssh.peerjs.configuration=${configuration}`)} \
    -p 0.0.0.0:${listenPort}:${listenPort} \
    ${this.shell(image)} \
    --port ${listenPort} --path ${this.shell(pathname)} \
    --key ${this.shell(key)} --proxied >/dev/null
else
  docker start peerjs >/dev/null
fi
test "$(docker inspect -f '{{.State.Running}}' peerjs)" = true
for attempt in $(seq 1 40); do
  if curl --fail --silent ${this.shell(`http://127.0.0.1:${listenPort}${pathname}`)} \
    | grep -q 'PeerJS'; then
    exit 0
  fi
  sleep 0.25
done
docker logs --tail 40 peerjs >&2 || true
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

  get endpoint() {
    const { peerjs } = store.getState();
    const ssh = new Ssh();
    const stunServer = new StunServer();
    return {
      host: ssh.host,
      port: peerjs.listenPort,
      path: peerjs.pathname,
      secure: false as const,
      key: peerjs.key,
      config: {
        iceServers: [{ urls: `stun:${ssh.host}:${stunServer.port}` }],
      },
    };
  }

  vite() {
    return {
      state: this.endpoint,
      actions: async () => {
        const stunServer = new StunServer();
        await this.setupReady();
        await stunServer.setupReady();
        return async () => { };
      },
    };
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }
}
