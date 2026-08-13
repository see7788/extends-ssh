import type Nodejs from "../Nodejs/index.ts";
import type Ssh from "../Ssh/index.ts";

type RemoteProcess = {
  name: string;
  path: string;
  command: string;
  port: number;
  environment?: Record<string, string>;
};

export default abstract class Pm2 {
  protected abstract readonly nodejs: Nodejs;
  protected abstract readonly ssh: Ssh;
  private remoteRunningPromise?: Promise<void>;

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

  /** 启动远端 PM2 进程，并确认该进程树监听指定端口。 */
  public async processIsRemoteRunning(process: RemoteProcess): Promise<void> {
    await this.isRemoteRunning();
    const name = this.nameRequired(process.name);
    const port = this.portRequired(process.port);
    const environment = Object.entries(process.environment ?? {})
      .map(([key, value]) => `${this.environmentNameRequired(key)}=${this.shell(value)}`)
      .join(" ");
    await this.ssh.execute(`
set -e
pm2 delete ${this.shell(name)} >/dev/null 2>&1 || true
cd ${this.shell(process.path)}
${environment} pm2 start bash --name ${this.shell(name)} -- -lc ${this.shell(process.command)}
pm2 save --force >/dev/null
for attempt in $(seq 1 20); do
  ROOT_PID=$(pm2 pid ${this.shell(name)})
  if [ -n "$ROOT_PID" ] && [ "$ROOT_PID" != 0 ]; then
    PIDS="$ROOT_PID"
    CURRENT="$ROOT_PID"
    while [ -n "$CURRENT" ]; do
      CHILDREN=""
      for PID in $CURRENT; do CHILDREN="$CHILDREN $(pgrep -P "$PID" 2>/dev/null || true)"; done
      PIDS="$PIDS $CHILDREN"
      CURRENT="$CHILDREN"
    done
    for PID in $PIDS; do
      if lsof -Pan -p "$PID" -iTCP:${port} -sTCP:LISTEN >/dev/null 2>&1; then exit 0; fi
    done
  fi
  sleep 0.5
done
pm2 logs ${this.shell(name)} --lines 40 --nostream >&2 || true
echo ${this.shell(`PM2 进程未监听端口 ${port}: ${name}`)} >&2
exit 1
`);
  }

  /** 停止远端 PM2 进程。 */
  public async processRemoteClose(name: string): Promise<void> {
    await this.ssh.isRunning();
    await this.ssh.execute(`
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete ${this.shell(this.nameRequired(name))} >/dev/null 2>&1 || true
  pm2 save --force >/dev/null 2>&1 || true
fi
`);
  }

  private async remoteRunningEnsure(): Promise<void> {
    await this.nodejs.isRemoteRunning();
    await this.ssh.execute(`
set -e
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
PM2="$(command -v pm2)"
test -x "$PM2"
if [ "$PM2" != /usr/local/bin/pm2 ]; then
  ln -sfn "$PM2" /usr/local/bin/pm2
fi
pm2 ping >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null
pm2 save --force >/dev/null
systemctl enable pm2-root >/dev/null
systemctl is-enabled --quiet pm2-root
pm2 --version >/dev/null
`);
  }

  private nameRequired(name: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
      throw new TypeError(`PM2 进程名称无效: ${name}`);
    }
    return name;
  }

  private portRequired(port: number): number {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new TypeError(`PM2 进程端口无效: ${String(port)}`);
    }
    return port;
  }

  private environmentNameRequired(name: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new TypeError(`PM2 环境变量名称无效: ${name}`);
    }
    return name;
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }
}
