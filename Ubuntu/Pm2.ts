import Public from "extends-ssh/Ubuntu/public.ts";
import store from "extends-ssh/Ubuntu/store.ts";

export type Pm2ProcessState = {
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
  private readonly runtime = new Public();
  private prepared = false;

  /** 交付远程 PM2 daemon 与其全部进程的当前运行时数据。 */
  public readonly state: {
    host: string;
    status: "unknown" | "running";
    processes: Pm2ProcessState[];
    updatedAt?: string;
  } = {
    host: store.getState().ssh.host,
    status: "unknown",
    processes: [],
  };

  /** 确保远程 PM2 可用并刷新完整进程数据。 */
  public async isRunning(): Promise<typeof this.state> {
    if (!this.prepared) {
      await this.runtime.pm2IsRunning();
      this.prepared = true;
    }
    return this.refresh();
  }

  /** 从远程 PM2 daemon 重新读取全部进程数据。 */
  public async refresh(): Promise<typeof this.state> {
    const result = await this.runtime.execute("pm2 jlist");
    const payload: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(payload)) throw new TypeError("PM2 jlist 未返回进程数组");
    this.state.host = store.getState().ssh.host;
    this.state.status = "running";
    this.state.processes = payload.map((value, index) => this.processParse(value, index));
    this.state.updatedAt = new Date().toISOString();
    return this.state;
  }

  /** 停止指定远程 PM2 进程并交付更新后的完整状态。 */
  public async stop(id: number): Promise<typeof this.state> {
    this.idValidate(id);
    await this.isRunning();
    await this.runtime.execute(`pm2 stop ${String(id)} && pm2 save --force >/dev/null`);
    return this.refresh();
  }

  /** 重启指定远程 PM2 进程并交付更新后的完整状态。 */
  public async restart(id: number): Promise<typeof this.state> {
    this.idValidate(id);
    await this.isRunning();
    await this.runtime.execute(`pm2 restart ${String(id)} && pm2 save --force >/dev/null`);
    return this.refresh();
  }

  /** 关闭当前 PM2 生产者持有的 SSH 会话。 */
  public dispose(): void {
    this.runtime.dispose();
    this.prepared = false;
  }

  private idValidate(id: number): void {
    if (!Number.isInteger(id) || id < 0) throw new TypeError(`PM2 id 无效: ${String(id)}`);
  }

  private processParse(value: unknown, index: number): Pm2ProcessState {
    if (!value || typeof value !== "object") throw new TypeError(`PM2 进程 ${String(index)} 不是对象`);
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
}
