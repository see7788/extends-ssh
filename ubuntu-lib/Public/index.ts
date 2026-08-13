import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import {
  isAbsolute,
  posix,
  relative,
  resolve,
} from "node:path";
import Sftp from "../Sftp/index.ts";
import store from "../store.ts";
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
    await this.ssh.connect(store.getState().public.ssh);
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

  /** 确保 TypeScript 源码服务的目标版本已发布、由 PM2 运行并通过远端健康检查。 */
  public async serviceIsRunning<const Environment extends Record<string, string>>(service: {
    entry: string;
    name: string;
    path: string;
    environment: Environment;
    healthCommand: string;
  }): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(service.name)) {
      throw new TypeError(`远端服务名称无效: ${service.name}`);
    }
    if (!isAbsolute(service.path)) {
      throw new TypeError(`远端服务源码目录必须是绝对路径: ${service.path}`);
    }
    if (!existsSync(service.path) || !lstatSync(service.path).isDirectory()) {
      throw new Error(`远端服务源码目录不存在: ${service.path}`);
    }
    if (!/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~/-]+\.tsx?$/.test(service.entry)) {
      throw new TypeError(`远端服务 TypeScript 入口无效: ${service.entry}`);
    }
    const entryPath = resolve(service.path, service.entry);
    if (!existsSync(entryPath) || !lstatSync(entryPath).isFile()) {
      throw new Error(`远端服务 TypeScript 入口不存在: ${entryPath}`);
    }
    if (!service.healthCommand.trim()) {
      throw new TypeError(`远端服务健康检查不能为空: ${service.name}`);
    }
    for (const name of Object.keys(service.environment)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new TypeError(`远端服务环境变量名称无效: ${name}`);
      }
    }

    const sourcePackagePath = resolve(service.path, "package.json");
    if (!existsSync(sourcePackagePath)) {
      throw new Error(`远端服务 package.json 不存在: ${sourcePackagePath}`);
    }
    const sourcePackage = JSON.parse(readFileSync(sourcePackagePath, "utf8")) as {
      dependencies?: unknown;
      name?: unknown;
      type?: unknown;
    };
    if (
      !sourcePackage.dependencies
      || typeof sourcePackage.dependencies !== "object"
      || Array.isArray(sourcePackage.dependencies)
    ) throw new TypeError(`远端服务 dependencies 无效: ${sourcePackagePath}`);
    const dependencies: Record<string, string> = {};
    for (const [name, version] of Object.entries(sourcePackage.dependencies)) {
      if (
        !/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name)
        || typeof version !== "string"
        || !version
        || /^(?:workspace|file|link):/.test(version)
      ) throw new TypeError(`远端服务生产依赖无效: ${name}@${String(version)}`);
      dependencies[name] = version;
    }
    if (typeof dependencies.tsx !== "string") {
      throw new TypeError(`远端 TypeScript 服务必须在 dependencies 声明 tsx: ${sourcePackagePath}`);
    }
    const deploymentPackage = `${JSON.stringify({
      name: typeof sourcePackage.name === "string" ? sourcePackage.name : service.name,
      private: true,
      type: sourcePackage.type === "commonjs" ? "commonjs" : "module",
      dependencies: Object.fromEntries(
        Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right)),
      ),
    }, null, 2)}\n`;
    const remoteRoot = store.getState().public.remoteRoot;
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
    const ignoredNames = new Set([".git", ".ubuntu-lib", "dist", "node_modules"]);
    const sourceIncluded = (localPath: string): boolean => {
      const segments = relative(service.path, localPath).split(/[\\/]/).filter(Boolean);
      return !segments.some(segment => ignoredNames.has(segment))
        && !segments.some(segment => segment === ".env" || segment.startsWith(".env."))
        && !lstatSync(localPath).isSymbolicLink();
    };
    const sourceHash = createHash("sha256");
    const sourceHashUpdate = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const localPath = resolve(directory, entry.name);
        if (!sourceIncluded(localPath)) continue;
        const sourceName = relative(service.path, localPath).replaceAll("\\", "/");
        if (entry.isDirectory()) sourceHashUpdate(localPath);
        if (entry.isFile()) sourceHash.update(sourceName).update("\0").update(readFileSync(localPath));
      }
    };
    sourceHashUpdate(service.path);
    const revision = sourceHash
      .update("\0")
      .update(deploymentPackage)
      .update("\0")
      .update(JSON.stringify({
        entry: service.entry,
        environment,
        healthCommand: service.healthCommand,
      }))
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
    const uploaded = await this.ssh.putDirectory(service.path, incoming, {
      recursive: true,
      validate: sourceIncluded,
    });
    if (!uploaded) throw new Error(`远端服务源码上传失败: ${service.name}`);

    const environmentCommand = Object.entries(environment)
      .map(([name, value]) => `${name}=${this.shell(value)}`)
      .join(" ");
    const start = [
      "#!/usr/bin/env bash",
      "set -e",
      'cd -- "$(dirname -- "$0")"',
      `exec env ${environmentCommand} ./node_modules/.bin/tsx ${this.shell(service.entry)}`,
      "",
    ].join("\n");
    await this.execute(`
set -e
if [ -d ${this.shell(release)} ]; then
  rm -rf ${this.shell(incoming)}
else
  cd ${this.shell(incoming)}
  test -f ${this.shell(service.entry)}
  printf %s ${this.shell(deploymentPackage)} > package.json
  npm install --omit=dev --no-package-lock
  printf %s ${this.shell(revision)} > .ubuntu-service-revision
  printf %s ${this.shell(start)} > .ubuntu-service-start
  chmod 700 .ubuntu-service-start
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
