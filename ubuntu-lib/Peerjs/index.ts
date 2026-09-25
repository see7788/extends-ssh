import Base from "../public/Base.ts";
import { docker } from "../docker/index.ts";
import mcpserver from "mcpserver";
import { ssh } from "../ssh/index.ts";
import store from "../store/index.ts";

type Current = {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly secure: false;
  readonly key: string;
};

class Peerjs extends Base<() => Promise<Current>> {
  readonly current = async (): Promise<Current> => {
    await this.remoteIsRunning();
    const { peerjs, ssh: sshState } = store.getState();
    return {
      host: sshState.host,
      port: peerjs.listenPort,
      path: peerjs.pathname,
      secure: false,
      key: peerjs.key,
    };
  };

  protected remoteIsRunning(): Promise<void> {
    return this.ensureRemoteIsRunning(async () => {
      const { peerjs, ssh: sshState } = store.getState();
      const { image, key, listenPort, pathname } = peerjs;
      const configuration = `${image}|${listenPort}|${pathname}|${key}`;
      await docker.current();
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
      `http://${sshState.host}:${listenPort}${pathname}`,
      { signal: AbortSignal.timeout(10_000) },
    );
      if (!health.ok) {
        throw new Error(`PeerJS 连接健康检查失败: HTTP ${health.status}`);
      }
    });
  }

  async hasRemote(): Promise<boolean> {
    const { image, key, listenPort, pathname } = store.getState().peerjs;
    const configuration = `${image}|${listenPort}|${pathname}|${key}`;
    const result = await ssh.execute(`
if docker inspect peerjs >/dev/null 2>&1 \
  && [ "$(docker inspect -f '{{ index .Config.Labels "extends-ssh.peerjs.configuration" }}' peerjs)" = ${this.shell(configuration)} ] \
  && [ "$(docker inspect -f '{{.State.Running}}' peerjs)" = true ] \
  && curl --fail --silent ${this.shell(`http://127.0.0.1:${listenPort}${pathname}`)} | grep -q 'PeerJS'; then
  printf true
else
  printf false
fi`);
    return result.stdout.trim() === "true";
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }
}

export const peerjs = new Peerjs();

export default mcpserver.metas("/peerjs")
  .add({
    protocol: "tool",
    path: "/hasRemote",
    description: "检查远端 PeerJS 服务是否已经可用，不执行安装。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => ({ hasRemote: await peerjs.hasRemote() }),
  })
  .add({
    protocol: "tool",
    path: "/state",
    description: "确保并读取 PeerJS 连接配置。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => peerjs.current(),
  })
  .add({
    protocol: "tool",
    path: "/ensure",
    description: "检查并确保远端 PeerJS 服务处于可用状态。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => {
      await peerjs.current();
      return { ready: true };
    },
  });
