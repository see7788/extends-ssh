import Nginx from "../Nginx/index.ts";
import Public from "../Public/index.ts";
import store from "../store.ts";

export default class Peerjs {
  private remoteRunningPromise?: Promise<void>;

  constructor(private readonly nginx: Nginx) {}

  public get state() {
    const { peerjs } = store.getState();
    return {
      host: `webrtc.${this.nginx.state.domain}`,
      port: this.nginx.state.httpsPort,
      path: peerjs.pathname,
      secure: this.nginx.state.secure,
      key: peerjs.key,
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

  private async remoteRunningEnsure(): Promise<void> {
    const { peerjs } = store.getState();
    const configuration = `${peerjs.image}|${peerjs.listenPort}|${peerjs.pathname}|${peerjs.key}`;
    const runtime = new Public();
    try {
      await runtime.execute(`
set -e
docker info >/dev/null
if docker inspect peerjs >/dev/null 2>&1; then
  CURRENT_CONFIGURATION="$(docker inspect -f '{{ index .Config.Labels "extends-ssh.peerjs.configuration" }}' peerjs)"
  if [ "$CURRENT_CONFIGURATION" != ${this.shell(configuration)} ]; then
    docker rm -f peerjs >/dev/null
  fi
fi
if ! docker inspect peerjs >/dev/null 2>&1; then
  docker pull ${this.shell(peerjs.image)}
  docker run -d --restart=unless-stopped --name peerjs \
    --label ${this.shell(`extends-ssh.peerjs.configuration=${configuration}`)} \
    -p 127.0.0.1:${peerjs.listenPort}:9000 \
    ${this.shell(peerjs.image)} \
    --port 9000 --path ${this.shell(peerjs.pathname)} \
    --key ${this.shell(peerjs.key)} --proxied >/dev/null
else
  docker start peerjs >/dev/null
fi
test "$(docker inspect -f '{{.State.Running}}' peerjs)" = true
for attempt in $(seq 1 40); do
  if curl --fail --silent ${this.shell(`http://127.0.0.1:${peerjs.listenPort}${peerjs.pathname}`)} \
    | grep -q 'PeerJS'; then
    exit 0
  fi
  sleep 0.25
done
docker logs --tail 40 peerjs >&2 || true
exit 1
`);
    } finally {
      runtime.dispose();
    }

    const state = this.state;
    await this.nginx.proxyRouteIsRunning({
      name: "peerjs",
      hostname: state.host,
      pathname: state.path,
      upstreamPort: peerjs.listenPort,
    });
    const health = await fetch(
      `https://${state.host}${state.path}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!health.ok) {
      throw new Error(`PeerJS 公网健康检查失败: HTTP ${health.status}`);
    }
  }

  private shell(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }
}
