import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Public from "../public.ts";
import store from "../store.ts";
import type {
  SshServiceRegistration,
  SshServiceState,
} from "./store.ts";

const serviceNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const entryPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const remotePathPattern = /^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const environmentNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

const shell = (value: string): string => (
  `'${value.replaceAll("'", `'"'"'`)}'`
);

const registrationValidate = (
  registration: SshServiceRegistration,
): void => {
  if (!serviceNamePattern.test(registration.name)) {
    throw new TypeError(`SSH 服务名称无效: ${registration.name}`);
  }
  if (!path.isAbsolute(registration.localPath)) {
    throw new TypeError(
      `SSH 服务本地产物路径必须是绝对路径: ${registration.localPath}`,
    );
  }
  if (!remotePathPattern.test(registration.remotePath)) {
    throw new TypeError(
      `SSH 服务远端路径无效: ${registration.remotePath}`,
    );
  }
  if (!serviceNamePattern.test(registration.processName)) {
    throw new TypeError(
      `SSH 服务进程名称无效: ${registration.processName}`,
    );
  }
  if (!entryPattern.test(registration.entry)) {
    throw new TypeError(`SSH 服务入口名称无效: ${registration.entry}`);
  }
  if (!registration.healthCommand.trim()) {
    throw new TypeError(`SSH 服务健康检查不能为空: ${registration.name}`);
  }
  for (const name of Object.keys(registration.environment)) {
    if (!environmentNamePattern.test(name)) {
      throw new TypeError(`SSH 服务环境变量名称无效: ${name}`);
    }
  }
};

export class Service {
  private readonly runtime = new Public();
  private running?: Promise<SshServiceState>;

  constructor(public readonly name: string) {
    if (!store.getState().sshServices[name]) {
      throw new Error(`SSH 服务尚未注册: ${name}`);
    }
  }

  /** 交付当前服务的注册定义、目标版本和运行状态。 */
  public get state(): SshServiceState {
    const service = store.getState().sshServices[this.name];
    if (!service) throw new Error(`SSH 服务尚未注册: ${this.name}`);
    return service;
  }

  /** 确保目标版本已经原子发布、由 PM2 运行并通过健康检查。 */
  public isRunning(): Promise<SshServiceState> {
    if (this.running) return this.running;
    this.running = this.runningEnsure().finally(() => {
      this.running = undefined;
      this.runtime.dispose();
    });
    return this.running;
  }

  private async runningEnsure(): Promise<SshServiceState> {
    try {
      const definition = this.state;
      if (!existsSync(definition.localPath)) {
        throw new Error(
          `SSH 服务本地产物不存在: ${definition.localPath}`,
        );
      }
      const content = readFileSync(definition.localPath);
      const contentHash = createHash("sha256").update(content).digest("hex");
      const revision = createHash("sha256")
        .update(content)
        .update("\0")
        .update(JSON.stringify({
          entry: definition.entry,
          environment: Object.fromEntries(
            Object.entries(definition.environment).sort(([left], [right]) => (
              left.localeCompare(right)
            )),
          ),
          healthCommand: definition.healthCommand,
        }))
        .digest("hex");
      store.getState().sshServicesActions.targetSet(this.name, revision);
      await this.runtime.pm2IsRunning();

      if (await this.remoteReady(this.state, revision)) {
        store.getState().sshServicesActions.runningSet(this.name);
        return this.state;
      }
      await this.releaseUpload(this.state, revision, contentHash);
      await this.releaseActivate(this.state, revision);
      store.getState().sshServicesActions.runningSet(this.name);
      return this.state;
    } catch (error) {
      store.getState().sshServicesActions.failureSet(
        this.name,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async remoteReady(
    service: SshServiceState,
    revision: string,
  ): Promise<boolean> {
    const remotePath = shell(service.remotePath);
    const processName = shell(service.processName);
    const expected = shell(revision);
    const result = await this.runtime.execute(`
set -e
CURRENT_REVISION="$(cat ${remotePath}/current/.ubuntu-service-revision 2>/dev/null || true)"
PID="$(pm2 pid ${processName} 2>/dev/null || true)"
if [ "$CURRENT_REVISION" = ${expected} ] \
  && [ -n "$PID" ] \
  && [ "$PID" -gt 0 ] 2>/dev/null \
  && (${service.healthCommand}) >/dev/null 2>&1; then
  printf ready
else
  printf deploy
fi
`);
    return result.stdout.trim() === "ready";
  }

  private async releaseUpload(
    service: SshServiceState,
    revision: string,
    contentHash: string,
  ): Promise<void> {
    const incoming = `${service.remotePath}/.incoming-${revision}`;
    await this.runtime.execute(`
set -e
mkdir -p ${shell(`${service.remotePath}/releases`)}
rm -rf ${shell(incoming)}
mkdir -p ${shell(incoming)}
`);
    await this.runtime.ssh.putFile(
      service.localPath,
      `${incoming}/${service.entry}`,
    );

    const environment = Object.entries(service.environment)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${shell(value)}`)
      .join(" ");
    const start = [
      "#!/usr/bin/env bash",
      "set -e",
      'cd -- "$(dirname -- "$0")"',
      `exec env ${environment} node ${shell(service.entry)}`,
      "",
    ].join("\n");
    const release = `${service.remotePath}/releases/${revision}`;
    await this.runtime.execute(`
set -e
test "$(sha256sum ${shell(`${incoming}/${service.entry}`)} | awk '{print $1}')" = ${shell(contentHash)}
printf %s ${shell(revision)} > ${shell(`${incoming}/.ubuntu-service-revision`)}
printf %s ${shell(start)} > ${shell(`${incoming}/.ubuntu-service-start`)}
chmod 700 ${shell(`${incoming}/.ubuntu-service-start`)}
if [ -d ${shell(release)} ]; then
  rm -rf ${shell(incoming)}
else
  mv ${shell(incoming)} ${shell(release)}
fi
`);
  }

  private async releaseActivate(
    service: SshServiceState,
    revision: string,
  ): Promise<void> {
    const remotePath = service.remotePath;
    const release = `${remotePath}/releases/${revision}`;
    const current = `${remotePath}/current`;
    const next = `${remotePath}/.current-next`;
    const processName = shell(service.processName);
    await this.runtime.execute(`
set -e
PREVIOUS="$(readlink -f ${shell(current)} 2>/dev/null || true)"
rollback() {
  STATUS=$?
  trap - ERR
  pm2 delete ${processName} >/dev/null 2>&1 || true
  if [ -n "$PREVIOUS" ] && [ -f "$PREVIOUS/.ubuntu-service-start" ]; then
    ln -sfn "$PREVIOUS" ${shell(next)}
    mv -Tf ${shell(next)} ${shell(current)}
    cd ${shell(current)}
    pm2 start ./.ubuntu-service-start --name ${processName} --interpreter bash >/dev/null
  else
    rm -f ${shell(current)} ${shell(next)}
  fi
  pm2 save --force >/dev/null 2>&1 || true
  exit "$STATUS"
}
trap rollback ERR
ln -sfn ${shell(release)} ${shell(next)}
mv -Tf ${shell(next)} ${shell(current)}
pm2 delete ${processName} >/dev/null 2>&1 || true
cd ${shell(current)}
pm2 start ./.ubuntu-service-start --name ${processName} --interpreter bash >/dev/null
pm2 save --force >/dev/null
HEALTHY=0
for attempt in $(seq 1 40); do
  if (${service.healthCommand}) >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 0.25
done
test "$HEALTHY" = 1
trap - ERR
`);
  }
}

export default class Services {
  private readonly services = new Map<string, Service>();

  /** 登记一个具体服务的本地产物、远端发布参数和健康检查。 */
  public register(registration: SshServiceRegistration): Service {
    registrationValidate(registration);
    store.getState().sshServicesActions.register(
      structuredClone(registration),
    );
    return this.get(registration.name);
  }

  /** 取得已经注册的具体服务生产者。 */
  public get(name: string): Service {
    const current = this.services.get(name);
    if (current) return current;
    const service = new Service(name);
    this.services.set(name, service);
    return service;
  }
}
