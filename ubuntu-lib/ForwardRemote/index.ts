import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import Public from "../public.ts";
import store from "../store.ts";

const shell = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

export default class ForwardRemote {
  private isRunningPromise?: Promise<void>;

  public isRunning(): Promise<void> {
    if (this.isRunningPromise) return this.isRunningPromise;

    const runtime = new Public();
    let deploymentPromise!: Promise<void>;
    deploymentPromise = Promise.resolve()
      .then(async () => {
        const { path, remotePath, jwtSecret } = store.getState().forwardRemote;
        if (!existsSync(path)) {
          throw new Error(`远端服务本地产物不存在: ${path}`);
        }

        const { ssh, stunServer, webrtcProxy } = store.getState();
        const { port: peerPort, path: peerPath } = webrtcProxy;
        const { port: stunPort } = stunServer;
        for (const port of [peerPort, stunPort]) {
          if (!Number.isInteger(port) || port < 1 || port > 65_535) {
            throw new TypeError(`WebRTC 端口必须是 1-65535 的整数: ${String(port)}`);
          }
        }
        if (!/^\/[A-Za-z0-9/_-]*$/.test(peerPath)) {
          throw new TypeError(`WebRTC 信令路径无效: ${peerPath}`);
        }

        const processName = "webrtcsignaling";
        const entry = "index.js";
        const healthCommand =
          `curl --fail --silent http://127.0.0.1:${peerPort}/ | grep '"name":"webrtcsignaling"'`;
        const environment = Object.fromEntries(
          Object.entries({
            WS_NO_BUFFER_UTIL: "1",
            WS_NO_UTF_8_VALIDATE: "1",
            WEBRTC_RTC_CONFIGURATION: JSON.stringify({
              iceServers: [{ urls: `stun:${ssh.host}:${stunPort}` }],
            }),
            WEBRTC_SIGNALING_HOSTNAME: "0.0.0.0",
            WEBRTC_SIGNALING_JWT_SECRET: jwtSecret,
            WEBRTC_SIGNALING_PATH: peerPath,
            WEBRTC_SIGNALING_PORT: String(peerPort),
            WEBRTC_SIGNALING_TOKEN_TTL_SECONDS: "300",
          }).sort(([left], [right]) => left.localeCompare(right)),
        );
        const content = readFileSync(path);
        const contentHash = createHash("sha256").update(content).digest("hex");
        const revision = createHash("sha256")
          .update(content)
          .update("\0")
          .update(JSON.stringify({ entry, environment, healthCommand }))
          .digest("hex");
        const incoming = `${remotePath}/.incoming-${revision}`;
        const release = `${remotePath}/releases/${revision}`;
        const current = `${remotePath}/current`;
        const next = `${remotePath}/.current-next`;

        await runtime.pm2IsRunning();
        const readiness = await runtime.execute(`
set -e
CURRENT_REVISION="$(cat ${shell(`${current}/.ubuntu-service-revision`)} 2>/dev/null || true)"
PID="$(pm2 pid ${shell(processName)} 2>/dev/null || true)"
if [ "$CURRENT_REVISION" = ${shell(revision)} ] \
  && [ -n "$PID" ] \
  && [ "$PID" -gt 0 ] 2>/dev/null \
  && (${healthCommand}) >/dev/null 2>&1; then
  printf ready
else
  printf deploy
fi
`);
        if (readiness.stdout.trim() === "ready") return;

        await runtime.execute(`
set -e
mkdir -p ${shell(`${remotePath}/releases`)}
rm -rf ${shell(incoming)}
mkdir -p ${shell(incoming)}
`);
        await runtime.ssh.putFile(path, `${incoming}/${entry}`);

        const environmentCommand = Object.entries(environment)
          .map(([name, value]) => `${name}=${shell(value)}`)
          .join(" ");
        const start = [
          "#!/usr/bin/env bash",
          "set -e",
          'cd -- "$(dirname -- "$0")"',
          `exec env ${environmentCommand} node ${shell(entry)}`,
          "",
        ].join("\n");
        await runtime.execute(`
set -e
test "$(sha256sum ${shell(`${incoming}/${entry}`)} | awk '{print $1}')" = ${shell(contentHash)}
printf %s ${shell(revision)} > ${shell(`${incoming}/.ubuntu-service-revision`)}
printf %s ${shell(start)} > ${shell(`${incoming}/.ubuntu-service-start`)}
chmod 700 ${shell(`${incoming}/.ubuntu-service-start`)}
if [ -d ${shell(release)} ]; then
  rm -rf ${shell(incoming)}
else
  mv ${shell(incoming)} ${shell(release)}
fi
`);

        await runtime.execute(`
set -e
PREVIOUS="$(readlink -f ${shell(current)} 2>/dev/null || true)"
rollback() {
  STATUS=$?
  trap - ERR
  pm2 delete ${shell(processName)} >/dev/null 2>&1 || true
  if [ -n "$PREVIOUS" ] && [ -f "$PREVIOUS/.ubuntu-service-start" ]; then
    ln -sfn "$PREVIOUS" ${shell(next)}
    mv -Tf ${shell(next)} ${shell(current)}
    cd ${shell(current)}
    pm2 start ./.ubuntu-service-start --name ${shell(processName)} --interpreter bash >/dev/null
  else
    rm -f ${shell(current)} ${shell(next)}
  fi
  pm2 save --force >/dev/null 2>&1 || true
  exit "$STATUS"
}
trap rollback ERR
ln -sfn ${shell(release)} ${shell(next)}
mv -Tf ${shell(next)} ${shell(current)}
pm2 delete ${shell(processName)} >/dev/null 2>&1 || true
cd ${shell(current)}
pm2 start ./.ubuntu-service-start --name ${shell(processName)} --interpreter bash >/dev/null
pm2 save --force >/dev/null
HEALTHY=0
for attempt in $(seq 1 40); do
  if (${healthCommand}) >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 0.25
done
test "$HEALTHY" = 1
trap - ERR
`);
      })
      .finally(() => {
        runtime.dispose();
        if (this.isRunningPromise === deploymentPromise) {
          this.isRunningPromise = undefined;
        }
      });

    this.isRunningPromise = deploymentPromise;
    return deploymentPromise;
  }
}
