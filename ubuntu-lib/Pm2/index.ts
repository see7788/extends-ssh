import Base from "../public/index.ts";
import Nodejs from "../nodejs/index.ts";
import Sftp from "../sftp/index.ts";
import Ssh from "../ssh/index.ts";

type Pm2Process = {
  readonly name: string;
  hasRemote(): Promise<boolean>;
  refresh(): Promise<"missing" | "stopped" | "running">;
  stop(): Promise<void>;
  restart(): Promise<void>;
  close(): Promise<void>;
};

export default class extends Base {
  vite(
    port: number,
    input: Omit<Parameters<this["makeRemote"]>[0], "port" | "cwd">,
  ) {
    return {
      state: { host: `${port}.${this.domain}` },
      actions: async () => {
        const sftp = new Sftp();
        const process = await this.makeRemote({
          ...input,
          cwd: sftp.remotePath(port),
          port,
        });
        return () => process.close();
      },
    };
  }
  protected async setup(): Promise<void> {
    const nodejs = new Nodejs();
    const ssh = new Ssh();
    await nodejs.setupReady();
    await ssh.execute("set -e; if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi; pm2 ping >/dev/null; pm2 save --force >/dev/null");
  }
  async getRemote(port: number): Promise<Pm2Process> {
    await this.setupReady();
    if (!await this.hasRemote(port)) {
      throw new Error(`开发端口尚未分配 PM2 进程: ${port}`);
    }
    return {
      name: String(port),
      hasRemote: () => this.hasRemote(port),
      refresh: () => this.refresh(port),
      stop: () => this.stop(port),
      restart: () => this.restart(port),
      close: () => this.closeRemote(port),
    };
  };
  async makeRemote(input: {
    port: number;
    cwd: string;
    command: string;
    environment?: Record<string, string>;
  }): Promise<Pm2Process> {
    await this.setupReady();
    const ssh = new Ssh();
    const current = await this.refresh(input.port);
    if (current !== "running" && await this.remotePortIsListening(input.port)) {
      throw new Error(`开发端口已被其他远程服务占用: ${input.port}`);
    }
    const name = String(input.port);
    const environment = Object.entries(input.environment ?? {}).map(([key, item]) => `${key}=${this.shell(item)}`).join(" ");
    await ssh.execute(`set -e
pm2 delete ${this.shell(name)} >/dev/null 2>&1 || true
cd ${this.shell(input.cwd)}
${environment} pm2 start bash --name ${this.shell(name)} -- -lc ${this.shell(input.command)}
pm2 save --force >/dev/null`);
    return {
      name,
      hasRemote: () => this.hasRemote(input.port),
      refresh: () => this.refresh(input.port),
      stop: () => this.stop(input.port),
      restart: () => this.restart(input.port),
      close: () => this.closeRemote(input.port),
    };
  }
  async refresh(port: number): Promise<"missing" | "stopped" | "running"> {
    await this.setupReady();
    const ssh = new Ssh();
    const result = await ssh.execute("pm2 jlist");
    const list: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(list)) throw new Error("PM2 未返回进程数组");
    const item = list.find((entry): entry is { name?: unknown; pm2_env?: { status?: unknown } } => typeof entry === "object" && entry !== null && (entry as { name?: unknown }).name === String(port));
    const status = item?.pm2_env?.status;
    return status === "online" ? "running" : item ? "stopped" : "missing";
  }
  async hasRemote(port: number): Promise<boolean> {
    const ssh = new Ssh();
    const result = await ssh.execute(`if command -v pm2 >/dev/null 2>&1 && pm2 describe ${this.shell(String(port))} >/dev/null 2>&1; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }
  async stop(port: number): Promise<void> {
    await this.setupReady();
    const ssh = new Ssh();
    const name = this.shell(String(port));
    await ssh.execute(`pm2 stop ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  async restart(port: number): Promise<void> {
    await this.setupReady();
    const ssh = new Ssh();
    const name = this.shell(String(port));
    await ssh.execute(`pm2 restart ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  async closeRemote(port: number): Promise<void> {
    await this.setupReady();
    const ssh = new Ssh();
    const name = this.shell(String(port));
    await ssh.execute(`pm2 delete ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  private async remotePortIsListening(port: number): Promise<boolean> {
    const ssh = new Ssh();
    const result = await ssh.execute(`ss -ltnH | awk '$4 ~ /(^|:)${port}$/ { found=1 } END { print found ? "true" : "false" }'`);
    return result.stdout.trim() === "true";
  }
  private shell(value: string): string { return "'" + value.replace(/'/g, "'\"'\"'") + "'"; }
}
