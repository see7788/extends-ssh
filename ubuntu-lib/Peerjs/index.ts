import type Docker from "../Docker/index.ts";
import type Nginx from "../Nginx/index.ts";
import type Ssh from "../Ssh/index.ts";
import store from "../store.ts";

export default abstract class Peerjs {
  protected abstract readonly docker: Docker;
  protected abstract readonly nginx: Nginx;
  protected abstract readonly ssh: Ssh;
  private remoteRunningPromise?: Promise<void>;

  public get state() {
    const { peerjs, public: publicState } = store.getState();
    const domain = publicState.domain.trim().toLowerCase();
    return {
      host: `webrtc.${domain}`,
      port: 443 as const,
      path: peerjs.pathname,
      secure: true as const,
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
    await this.docker.isRemoteRunning();
    await this.ssh.execute(`
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
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }
}
