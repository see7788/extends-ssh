import { nodejs } from "../Nodejs/index.ts";
import mcpserver from "mcpserver";
import { emptyValidator, mutate, read, remoteRead, type McpJsonContext } from "../mcpBase.ts";
import { ssh } from "../Ssh/index.ts";
import { z } from "zod";

export const idValidator = z.object({
  id: z.number().int().min(0),
}).strict();
export const processIsRemoteRunningValidator = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  path: z.string().trim().min(1),
  command: z.string().trim().min(1),
  port: z.number().int().min(1).max(65_535),
  environment: z.record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    z.string(),
  ).optional(),
}).strict();
export const processRemoteCloseValidator = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
}).strict();

export type IdInput = z.infer<typeof idValidator>;
export type RemoteProcess = z.infer<typeof processIsRemoteRunningValidator>;
export type ProcessRemoteClose = z.infer<typeof processRemoteCloseValidator>;

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

export default class Pm2 {
  protected readonly nodejs = nodejs;
  protected readonly ssh = ssh;
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
    const result = await this.ssh.execute("pm2 jlist");
    const payload: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(payload)) throw new TypeError("PM2 jlist 未返回进程数组");
    this.state.host = this.ssh.state.host;
    this.state.status = "running";
    this.state.processes = payload.map((value, index) => this.processParse(value, index));
    this.state.updatedAt = new Date().toISOString();
    return this.state;
  }

  public async stop(id: IdInput["id"]): Promise<typeof this.state> {
    const input = idValidator.parse({ id });
    await this.isRemoteRunning();
    await this.ssh.execute(`pm2 stop ${String(input.id)} && pm2 save --force >/dev/null`);
    return this.refresh();
  }

  public async restart(id: IdInput["id"]): Promise<typeof this.state> {
    const input = idValidator.parse({ id });
    await this.isRemoteRunning();
    await this.ssh.execute(`pm2 restart ${String(input.id)} && pm2 save --force >/dev/null`);
    return this.refresh();
  }

  public dispose(): void {
    this.ssh.dispose();
    this.remoteRunningPromise = undefined;
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
  public async processIsRemoteRunning(process: RemoteProcess): Promise<void> {
    const input = processIsRemoteRunningValidator.parse(process);
    await this.isRemoteRunning();
    const environment = Object.entries(input.environment ?? {})
      .map(([key, value]) => `${key}=${this.shell(value)}`)
      .join(" ");
    await this.ssh.execute(`
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
  public async processRemoteClose(name: ProcessRemoteClose["name"]): Promise<void> {
    const input = processRemoteCloseValidator.parse({ name });
    await this.ssh.isRunning();
    await this.ssh.execute(`
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete ${this.shell(input.name)} >/dev/null 2>&1 || true
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

export const pm2Slice = mcpserver.metas("pm2")
  .tool(
    "post",
    "/state",
    emptyValidator,
    "读取当前缓存的 PM2 进程状态。",
    read,
    (context: McpJsonContext<{}>) => context.json(pm2.state),
  )
  .tool(
    "post",
    "/refresh",
    emptyValidator,
    "从远端重新读取 PM2 进程并刷新状态。",
    remoteRead,
    async (context: McpJsonContext<{}>) => context.json(await pm2.refresh()),
  )
  .tool(
    "post",
    "/stop",
    idValidator,
    "按 PM2 进程编号停止一个远端进程。",
    mutate,
    async (context: McpJsonContext<IdInput>) => context.json(await pm2.stop(context.req.valid("json").id)),
  )
  .tool(
    "post",
    "/restart",
    idValidator,
    "按 PM2 进程编号重启一个远端进程。",
    mutate,
    async (context: McpJsonContext<IdInput>) => context.json(await pm2.restart(context.req.valid("json").id)),
  )
  .tool(
    "post",
    "/processIsRemoteRunning",
    processIsRemoteRunningValidator,
    "按名称启动 PM2 进程，并验证目标端口已可用。",
    mutate,
    async (context: McpJsonContext<RemoteProcess>) => {
      await pm2.processIsRemoteRunning(context.req.valid("json"));
      return context.json({ started: true });
    },
  )
  .tool(
    "post",
    "/processRemoteClose",
    processRemoteCloseValidator,
    "按名称停止一个远端 PM2 进程。",
    mutate,
    async (context: McpJsonContext<ProcessRemoteClose>) => {
      await pm2.processRemoteClose(context.req.valid("json").name);
      return context.json({ stopped: true });
    },
  );
