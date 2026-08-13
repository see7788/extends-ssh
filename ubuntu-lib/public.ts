import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, posix } from "node:path";
import Sftp from "./Sftp/index.ts";
import store from "./store.ts";
import { NodeSSH, type SSHExecCommandResponse } from "node-ssh";

export default class Public {
  public readonly ssh = new NodeSSH();
  public readonly sftp = new Sftp(
    this.ssh,
    () => this.sshIsRunning(),
    () => this.dispose(),
  );
  private readonly data = {
    connected: false,
    sshRevision: 0,
  };

  public get sshRevision(): number {
    return this.data.sshRevision;
  }

  /** 确保当前实例持有经过远程命令验证的 SSH 会话。 */
  public async sshIsRunning(): Promise<void> {
    if (this.data.connected) {
      try {
        const result = await this.ssh.execCommand("true");
        if (result.code === 0) return;
      } catch {
        this.ssh.dispose();
      }
        this.data.connected = false;
    }
    await this.ssh.connect(store.getState().ssh);
    const result = await this.ssh.execCommand("true");
    if (result.code !== 0) {
      this.ssh.dispose();
      throw new Error(`SSH 连接验证失败 (${String(result.code)})`, {
        cause: result.stderr || result.stdout,
      });
    }
    this.data.connected = true;
    this.data.sshRevision += 1;
  }

  /** 执行远程命令并交付包含输出和退出码的成功结果。 */
  public async execute(command: string): Promise<SSHExecCommandResponse> {
    await this.sshIsRunning();
    const result = await this.ssh.execCommand(command);
    if (result.code !== 0) {
      throw new Error(`远程命令失败 (${String(result.code)})\n${result.stderr || result.stdout}`);
    }
    return result;
  }

  /** 确保远程服务器拥有可用且随系统启动的 PM2 daemon。 */
  public async pm2IsRunning(): Promise<void> {
    await this.execute(`
set -e
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo '远程服务器缺少 Node.js 与 npm' >&2
  exit 1
fi
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
pm2 ping >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null
systemctl enable pm2-root >/dev/null
`);
  }

  /** 确保单文件 Node 服务的目标版本已发布、由 PM2 运行并通过远端健康检查。 */
  public async serviceIsRunning(service: {
    name: string;
    path: string;
    environment: Record<string, string>;
    healthCommand: string;
  }): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(service.name)) {
      throw new TypeError(`远端服务名称无效: ${service.name}`);
    }
    if (!isAbsolute(service.path)) {
      throw new TypeError(`远端服务产物路径必须是绝对路径: ${service.path}`);
    }
    if (!existsSync(service.path)) {
      throw new Error(`远端服务产物不存在: ${service.path}`);
    }
    if (!service.healthCommand.trim()) {
      throw new TypeError(`远端服务健康检查不能为空: ${service.name}`);
    }
    for (const name of Object.keys(service.environment)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new TypeError(`远端服务环境变量名称无效: ${name}`);
      }
    }

    const entry = basename(service.path);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry)) {
      throw new TypeError(`远端服务入口名称无效: ${entry}`);
    }
    const remoteRoot = store.getState().remoteRoot;
    if (
      !remoteRoot.startsWith("/")
      || remoteRoot.includes("\0")
      || remoteRoot.includes("\\")
      || posix.normalize(remoteRoot) !== remoteRoot
    ) {
      throw new TypeError(`远端服务根目录必须是 Linux 绝对路径: ${remoteRoot}`);
    }
    const remotePath = posix.join(remoteRoot, service.name);
    const environment = Object.fromEntries(
      Object.entries(service.environment).sort(([left], [right]) => left.localeCompare(right)),
    );
    const content = readFileSync(service.path);
    const contentHash = createHash("sha256").update(content).digest("hex");
    const revision = createHash("sha256")
      .update(content)
      .update("\0")
      .update(JSON.stringify({ entry, environment, healthCommand: service.healthCommand }))
      .digest("hex");
    const incoming = `${remotePath}/.incoming-${revision}`;
    const release = `${remotePath}/releases/${revision}`;
    const current = `${remotePath}/current`;
    const next = `${remotePath}/.current-next`;

    await this.pm2IsRunning();
    const readiness = await this.execute(`
set -e
CURRENT_REVISION="$(cat ${this.shell(`${current}/.ubuntu-service-revision`)} 2>/dev/null || true)"
PID="$(pm2 pid ${this.shell(service.name)} 2>/dev/null || true)"
if [ "$CURRENT_REVISION" = ${this.shell(revision)} ] \
  && [ -n "$PID" ] \
  && [ "$PID" -gt 0 ] 2>/dev/null \
  && (${service.healthCommand}) >/dev/null 2>&1; then
  printf ready
else
  printf deploy
fi
`);
    if (readiness.stdout.trim() === "ready") return;

    await this.execute(`
set -e
mkdir -p ${this.shell(`${remotePath}/releases`)}
rm -rf ${this.shell(incoming)}
mkdir -p ${this.shell(incoming)}
`);
    await this.sftp.remoteUpload(service.path, `${incoming}/${entry}`);

    const environmentCommand = Object.entries(environment)
      .map(([name, value]) => `${name}=${this.shell(value)}`)
      .join(" ");
    const start = [
      "#!/usr/bin/env bash",
      "set -e",
      'cd -- "$(dirname -- "$0")"',
      `exec env ${environmentCommand} node ${this.shell(entry)}`,
      "",
    ].join("\n");
    await this.execute(`
set -e
test "$(sha256sum ${this.shell(`${incoming}/${entry}`)} | awk '{print $1}')" = ${this.shell(contentHash)}
printf %s ${this.shell(revision)} > ${this.shell(`${incoming}/.ubuntu-service-revision`)}
printf %s ${this.shell(start)} > ${this.shell(`${incoming}/.ubuntu-service-start`)}
chmod 700 ${this.shell(`${incoming}/.ubuntu-service-start`)}
if [ -d ${this.shell(release)} ]; then
  rm -rf ${this.shell(incoming)}
else
  mv ${this.shell(incoming)} ${this.shell(release)}
fi
`);

    await this.execute(`
set -e
PREVIOUS="$(readlink -f ${this.shell(current)} 2>/dev/null || true)"
rollback() {
  STATUS=$?
  trap - ERR
  pm2 delete ${this.shell(service.name)} >/dev/null 2>&1 || true
  if [ -n "$PREVIOUS" ] && [ -f "$PREVIOUS/.ubuntu-service-start" ]; then
    ln -sfn "$PREVIOUS" ${this.shell(next)}
    mv -Tf ${this.shell(next)} ${this.shell(current)}
    cd ${this.shell(current)}
    pm2 start ./.ubuntu-service-start --name ${this.shell(service.name)} --interpreter bash >/dev/null
  else
    rm -f ${this.shell(current)} ${this.shell(next)}
  fi
  pm2 save --force >/dev/null 2>&1 || true
  exit "$STATUS"
}
trap rollback ERR
ln -sfn ${this.shell(release)} ${this.shell(next)}
mv -Tf ${this.shell(next)} ${this.shell(current)}
pm2 delete ${this.shell(service.name)} >/dev/null 2>&1 || true
cd ${this.shell(current)}
pm2 start ./.ubuntu-service-start --name ${this.shell(service.name)} --interpreter bash >/dev/null
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

  /** 关闭当前实例持有的 SSH 会话。 */
  public dispose(): void {
    this.ssh.dispose();
    this.data.connected = false;
    this.data.sshRevision += 1;
  }

  private shell(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }
}
