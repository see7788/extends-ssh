import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import type { SSHExecCommandResponse } from "node-ssh";

type PeerjsSlice = {
  Peerjs: {
    image: "peerjs/peerjs-server:1.0.2";
    key: "peerjs";
    listenPort: 9000;
    pathname: "/peerjs";
  };
  PeerjsActions: {
    isRemoteRunning(): Promise<void>;
  };
};

type PeerjsDependencies = {
  Public: {
    domain: string;
  };
  DockerActions: {
    isRemoteRunning(): Promise<void>;
  };
  NginxActions: {
    proxyRouteIsRunning(route: {
      name: string;
      hostname: string;
      pathname: string;
      upstreamPort: number;
    }): Promise<void>;
  };
  SshActions: {
    execute(command: string): Promise<SSHExecCommandResponse>;
  };
};

const s: immerStateCreator<PeerjsSlice, PeerjsDependencies> = (_set, get) => {
  let running: Promise<void> | undefined;
  const shell = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
  return {
    Peerjs: {
      image: "peerjs/peerjs-server:1.0.2",
      key: "peerjs",
      listenPort: 9000,
      pathname: "/peerjs",
    },
    PeerjsActions: {
      isRemoteRunning() {
        if (running) return running;
        const execution = (async () => {
          const { Peerjs } = get();
          const configuration = `${Peerjs.image}|${Peerjs.listenPort}|${Peerjs.pathname}|${Peerjs.key}`;
          await get().DockerActions.isRemoteRunning();
          await get().SshActions.execute(`
set -e
docker info >/dev/null
if docker inspect peerjs >/dev/null 2>&1; then
  CURRENT_CONFIGURATION="$(docker inspect -f '{{ index .Config.Labels "extends-ssh.peerjs.configuration" }}' peerjs)"
  if [ "$CURRENT_CONFIGURATION" != ${shell(configuration)} ]; then
    docker rm -f peerjs >/dev/null
  fi
fi
if ! docker inspect peerjs >/dev/null 2>&1; then
  docker pull ${shell(Peerjs.image)}
  docker run -d --restart=unless-stopped --name peerjs \
    --label ${shell(`extends-ssh.peerjs.configuration=${configuration}`)} \
    -p 127.0.0.1:${Peerjs.listenPort}:9000 \
    ${shell(Peerjs.image)} \
    --port 9000 --path ${shell(Peerjs.pathname)} \
    --key ${shell(Peerjs.key)} --proxied >/dev/null
else
  docker start peerjs >/dev/null
fi
test "$(docker inspect -f '{{.State.Running}}' peerjs)" = true
for attempt in $(seq 1 40); do
  if curl --fail --silent ${shell(`http://127.0.0.1:${Peerjs.listenPort}${Peerjs.pathname}`)} \
    | grep -q 'PeerJS'; then
    exit 0
  fi
  sleep 0.25
done
docker logs --tail 40 peerjs >&2 || true
exit 1
`);
          const state = {
            host: `webrtc.${get().Public.domain.trim().toLowerCase()}`,
            path: Peerjs.pathname,
          };
          await get().NginxActions.proxyRouteIsRunning({
            name: "peerjs",
            hostname: state.host,
            pathname: state.path,
            upstreamPort: Peerjs.listenPort,
          });
          const health = await fetch(`https://${state.host}${state.path}`, {
            signal: AbortSignal.timeout(10_000),
          });
          if (!health.ok) {
            throw new Error(`PeerJS 公网健康检查失败: HTTP ${health.status}`);
          }
        })().finally(() => {
          if (running === execution) running = undefined;
        });
        running = execution;
        return execution;
      },
    },
  };
};

export default s;
