import { nodejs } from "../Nodejs/index.ts";
import mcpserver from "mcpserver";
import { ssh } from "../Ssh/index.ts";
import { z } from "zod";

const idValidator = z.object({
  id: z.number().int().min(0),
}).strict();
const processIsRemoteRunningValidator = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  path: z.string().trim().min(1),
  command: z.string().trim().min(1),
  port: z.number().int().min(1).max(65_535),
  environment: z.record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    z.string(),
  ).optional(),
}).strict();
const processRemoteCloseValidator = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
}).strict();

type IdInput = z.infer<typeof idValidator>;

type Pm2ProcessState = {
  id: number;
  name: string;
  pid: number;
  status: string;
  restarts: number;
  startedAt?: string;
  script?: string;
  cwd?: string;
};

type Pm2JsonProcess = {
  name?: unknown;
  pid?: unknown;
  pm_id?: unknown;
  pm2_env?: {
    status?: unknown;
    restart_time?: unknown;
    pm_uptime?: unknown;
    pm_exec_path?: unknown;
    pm_cwd?: unknown;
  };
};

import type Base from "../Public/Base.ts";

class Pm2 implements Base {
  private remoteRunningPromise?: Promise<void>;

  public readonly state: {
    host: string;
    status: "unknown" | "running";
    processes: Pm2ProcessState[];
    updatedAt?: string;
  } = {
    host: "",
    status: "unknown",
    processes: [],
  };

  public async isRunning(): Promise<typeof this.state> {
    await this.isRemoteRunning();
    return this.refresh();
  }

  public async refresh(): Promise<typeof this.state> {
    const result = await ssh.execute("pm2 jlist");
    const payload: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(payload)) throw new TypeError("PM2 jlist 未返回进程数组");
    this.state.host = ssh.state.host;
    this.state.status = "running";
    this.state.processes = payload.map((value, index) => this.processParse(value, index));
    this.state.updatedAt = new Date().toISOString();
    return this.state;
  }

  public async stop(input: IdInput): Promise<typeof this.state> {
    const value = idValidator.parse(input);
    await this.isRemoteRunning();
    await ssh.execute(`pm2 stop ${String(value.id)} && pm2 save --force >/dev/null`);
    return this.refresh();
  }

  public async restart(input: IdInput): Promise<typeof this.state> {
    const value = idValidator.parse(input);
    await this.isRemoteRunning();
    await ssh.execute(`pm2 restart ${String(value.id)} && pm2 save --force >/dev/null`);
    return this.refresh();
  }

  public dispose(): void {
    this.state.status = "unknown";
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

  /** 启动远端 PM2 进程，并确认该进程树监听指定端口。 */
  public async processIsRemoteRunning(process: z.infer<typeof processIsRemoteRunningValidator>): Promise<void> {
    const input = processIsRemoteRunningValidator.parse(process);
    await this.isRemoteRunning();
    const environment = Object.entries(input.environment ?? {})
      .map(([key, value]) => `${key}=${this.shell(value)}`)
      .join(" ");
    await ssh.execute(`
set -e
pm2 delete ${this.shell(input.name)} >/dev/null 2>&1 || true
cd ${this.shell(input.path)}
${environment} pm2 start bash --name ${this.shell(input.name)} -- -lc ${this.shell(input.command)}
pm2 save --force >/dev/null
for attempt in $(seq 1 20); do
  ROOT_PID=$(pm2 pid ${this.shell(input.name)})
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
      if lsof -Pan -p "$PID" -iTCP:${input.port} -sTCP:LISTEN >/dev/null 2>&1; then exit 0; fi
    done
  fi
  sleep 0.5
done
pm2 logs ${this.shell(input.name)} --lines 40 --nostream >&2 || true
echo ${this.shell(`PM2 进程未监听端口 ${input.port}: ${input.name}`)} >&2
exit 1
`);
  }

  /** 停止远端 PM2 进程。 */
  public async processRemoteClose(input: z.infer<typeof processRemoteCloseValidator>): Promise<void> {
    const value = processRemoteCloseValidator.parse(input);
    await ssh.isRemoteRunning();
    await ssh.execute(`
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete ${this.shell(value.name)} >/dev/null 2>&1 || true
  pm2 save --force >/dev/null 2>&1 || true
fi
`);
  }

  private async remoteRunningEnsure(): Promise<void> {
    await nodejs.isRemoteRunning();
    await ssh.execute(`
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

  private processParse(value: unknown, index: number): Pm2ProcessState {
    if (!value || typeof value !== "object") {
      throw new TypeError(`PM2 进程 ${String(index)} 不是对象`);
    }
    const process = value as Pm2JsonProcess;
    const environment = process.pm2_env;
    if (
      !Number.isInteger(process.pm_id)
      || typeof process.name !== "string"
      || typeof process.pid !== "number"
      || !environment
      || typeof environment.status !== "string"
    ) {
      throw new TypeError(`PM2 进程 ${String(index)} 缺少必要运行数据`);
    }
    return {
      id: process.pm_id as number,
      name: process.name,
      pid: process.pid,
      status: environment.status,
      restarts: typeof environment.restart_time === "number" ? environment.restart_time : 0,
      startedAt: typeof environment.pm_uptime === "number"
        ? new Date(environment.pm_uptime).toISOString()
        : undefined,
      script: typeof environment.pm_exec_path === "string" ? environment.pm_exec_path : undefined,
      cwd: typeof environment.pm_cwd === "string" ? environment.pm_cwd : undefined,
    };
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }
}

export const pm2 = new Pm2();

export default mcpserver.metas("/pm2")
  .add({
    protocol: "tool",
    path: "/state",
    description: "读取当前缓存的 PM2 进程状态。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: input => pm2.state,
  })
  .add({
    protocol: "tool",
    path: "/refresh",
    description: "从远端重新读取 PM2 进程并刷新状态。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => await pm2.refresh(),
  })
  .add({
    protocol: "tool",
    path: "/stop",
    description: "按 PM2 进程编号停止一个远端进程。",
    schema: idValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => await pm2.stop(input),
  })
  .add({
    protocol: "tool",
    path: "/restart",
    description: "按 PM2 进程编号重启一个远端进程。",
    schema: idValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => await pm2.restart(input),
  })
  .add({
    protocol: "tool",
    path: "/processIsRemoteRunning",
    description: "按名称启动 PM2 进程，并验证目标端口已可用。",
    schema: processIsRemoteRunningValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      await pm2.processIsRemoteRunning(input);
      return { started: true };
    },
  })
  .add({
    protocol: "tool",
    path: "/processRemoteClose",
    description: "按名称停止一个远端 PM2 进程。",
    schema: processRemoteCloseValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      await pm2.processRemoteClose(input);
      return { stopped: true };
    },
  });
