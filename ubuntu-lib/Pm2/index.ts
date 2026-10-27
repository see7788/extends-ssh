import Base from "../public/index.ts";
import Nginx from "../nginx/index.ts";
import Nodejs from "../nodejs/index.ts";
import Sftp from "../sftp/index.ts";
import Ssh from "../ssh/index.ts";
import Vite from "../vite/index.ts";
import type { Plugin } from "vite";

type Pm2Process = {
  readonly name: string;
  hasRemote(): Promise<boolean>;
  refresh(): Promise<"missing" | "stopped" | "running">;
  stop(): Promise<void>;
  restart(): Promise<void>;
  close(): Promise<void>;
};

export default class extends Base {
  vitePlugin(
    port: number,
    input: Omit<Parameters<this["makeRemote"]>[0], "port" | "cwd">,
  ): Plugin {
    const vite = new Vite();
    const nginx = new Nginx("pm2");
    return {
      name: `pm2Plugin${port}`,
      enforce: "post",
      configResolved: async () => {
        vite.mergeState(port, {
          pm2: { url: nginx.getUrl(port) },
        });
      },
      closeBundle: async () => {
        const sftp = new Sftp();
        await this.makeRemote({
          ...input,
          cwd: sftp.remotePath(port),
          port,
        });
        await nginx.makeRemote(port);
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
    const environment = Object.entries(input.environment ?? {}).map(([key, item]) => `${key}=${ssh.quoteShellArg(item)}`).join(" ");
    await ssh.execute(`set -e
pm2 delete ${ssh.quoteShellArg(name)} >/dev/null 2>&1 || true
cd ${ssh.quoteShellArg(input.cwd)}
${environment} pm2 start bash --name ${ssh.quoteShellArg(name)} -- -lc ${ssh.quoteShellArg(input.command)}
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
    const result = await ssh.execute(`if command -v pm2 >/dev/null 2>&1 && pm2 describe ${ssh.quoteShellArg(String(port))} >/dev/null 2>&1; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }
  async stop(port: number): Promise<void> {
    await this.setupReady();
    const ssh = new Ssh();
    const name = ssh.quoteShellArg(String(port));
    await ssh.execute(`pm2 stop ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  async restart(port: number): Promise<void> {
    await this.setupReady();
    const ssh = new Ssh();
    const name = ssh.quoteShellArg(String(port));
    await ssh.execute(`pm2 restart ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  async closeRemote(port: number): Promise<void> {
    await this.setupReady();
    const ssh = new Ssh();
    const name = ssh.quoteShellArg(String(port));
    await ssh.execute(`pm2 delete ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  private async remotePortIsListening(port: number): Promise<boolean> {
    const ssh = new Ssh();
    const result = await ssh.execute(`ss -ltnH | awk '$4 ~ /(^|:)${port}$/ { found=1 } END { print found ? "true" : "false" }'`);
    return result.stdout.trim() === "true";
  }
}
