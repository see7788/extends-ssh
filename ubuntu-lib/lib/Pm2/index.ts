import mcpserver from "mcpserver";
import { z } from "zod";

import { nodejs } from "../Nodejs/index.ts";
import { sftp } from "../Sftp/index.ts";
import { sshForward } from "../SshForward/index.ts";
import store, { withPortLock } from "../store/index.ts";
import { ssh } from "../Ssh/index.ts";

const devPortValidator = z.number().int().min(1).max(9_999);

const portValidator = devPortValidator
  .refine(port => {
    const state = store.getState();
    return port !== 80
      && port !== 443
      && port !== state.ssh.port
      && port !== state.stunServer.port;
  }, "PM2 端口不能占用固定服务端口");
const processValidator = z.object({
  port: portValidator,
  command: z.string().trim().min(1),
  environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
}).strict();
const inputValidator = z.object({ port: devPortValidator }).strict();
type Remote = {
  readonly name: string;
  readonly path: string;
  hasRemote(): Promise<boolean>;
  refresh(): Promise<"missing" | "stopped" | "running">;
  stop(): Promise<void>;
  restart(): Promise<void>;
  close(): Promise<void>;
};

class Pm2 {
  private runningPromise?: Promise<void>;
  private remoteIsRunning(): Promise<void> {
    if (this.runningPromise) return this.runningPromise;
    const promise = this.ensure().finally(() => { if (this.runningPromise === promise) this.runningPromise = undefined; });
    this.runningPromise = promise;
    return promise;
  }
  public async getRemote(port: number): Promise<Remote> {
    const value = inputValidator.parse({ port }).port;
    if (!await this.hasRemote(value)) {
      throw new Error(`开发端口尚未分配 PM2 进程: ${value}`);
    }
    return this.remote(value);
  }
  public async makeRemote(input: z.infer<typeof processValidator>): Promise<Remote> {
    const value = processValidator.parse(input);
    return withPortLock(value.port, async () => {
    if (await sshForward.hasRemote(value.port)) throw new Error(`开发端口已被 SSH 内网穿透占用: ${value.port}`);
    await this.remoteIsRunning();
    const path = (await sftp.getRemote(value.port)).path;
    const current = await this.remoteStatus(value.port);
    if (current !== "running" && await this.remotePortIsListening(value.port)) {
      throw new Error(`开发端口已被其他远程服务占用: ${value.port}`);
    }
    const name = this.remoteDescription(value.port).name;
    const environment = Object.entries(value.environment ?? {}).map(([key, item]) => `${key}=${this.shell(item)}`).join(" ");
    await ssh.execute(`set -e
pm2 delete ${this.shell(name)} >/dev/null 2>&1 || true
cd ${this.shell(path)}
${environment} pm2 start bash --name ${this.shell(name)} -- -lc ${this.shell(value.command)}
pm2 save --force >/dev/null`);
      return this.remote(value.port);
    });
  }
  private async remoteStatus(port: number): Promise<"missing" | "stopped" | "running"> {
    const value = inputValidator.parse({ port }).port;
    await this.remoteIsRunning();
    const result = await ssh.execute(`pm2 jlist`);
    const list: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(list)) throw new Error("PM2 未返回进程数组");
    const item = list.find((entry): entry is { name?: unknown; pm2_env?: { status?: unknown } } => typeof entry === "object" && entry !== null && (entry as { name?: unknown }).name === this.remoteDescription(value).name);
    const status = item?.pm2_env?.status;
    const normalized = status === "online" ? "running" : item ? "stopped" : "missing";
    return normalized;
  }
  public async hasRemote(port: number): Promise<boolean> {
    const value = inputValidator.parse({ port }).port;
    return await this.remoteStatus(value) !== "missing" && await sftp.hasRemote(value);
  }
  public async refresh(port: number): Promise<"missing" | "stopped" | "running"> { return this.remoteStatus(port); }
  public async stop(port: number): Promise<void> {
    const value = inputValidator.parse({ port }).port;
    return withPortLock(value, async () => {
      await this.remoteIsRunning();
      const name = this.shell(this.remoteDescription(value).name);
      await ssh.execute(`pm2 stop ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
    });
  }
  public async restart(port: number): Promise<void> {
    const value = inputValidator.parse({ port }).port;
    return withPortLock(value, async () => {
      await this.remoteIsRunning();
      const name = this.shell(this.remoteDescription(value).name);
      await ssh.execute(`pm2 restart ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
    });
  }
  public async closeRemote(port: number): Promise<void> {
    const value = inputValidator.parse({ port }).port;
    return withPortLock(value, async () => {
      await this.remoteIsRunning();
      const name = this.shell(this.remoteDescription(value).name);
      await ssh.execute(`pm2 delete ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
    });
  }
  private async ensure(): Promise<void> { await nodejs.remoteIsRunning(); await ssh.execute("set -e; command -v pm2 >/dev/null 2>&1 || npm install -g pm2; pm2 ping >/dev/null; pm2 save --force >/dev/null"); }
  private async remotePortIsListening(port: number): Promise<boolean> {
    const result = await ssh.execute(`ss -ltnH | awk '$4 ~ /(^|:)${port}$/ { found=1 } END { print found ? "true" : "false" }'`);
    return result.stdout.trim() === "true";
  }
  private async remote(port: number): Promise<Remote> {
    const value = inputValidator.parse({ port }).port;
    const path = (await sftp.getRemote(value)).path;
    const name = this.remoteDescription(value).name;
    return {
      name,
      path,
      hasRemote: () => this.hasRemote(value),
      refresh: () => this.refresh(value),
      stop: () => this.stop(value),
      restart: () => this.restart(value),
      close: () => this.closeRemote(value),
    };
  }

  private shell(value: string): string { return "'" + value.replace(/'/g, "'\"'\"'") + "'"; }
  private remoteDescription(port: number): { name: string } {
    const value = inputValidator.parse({ port }).port;
    return { name: `app-${value}` };
  }
}

export const pm2 = new Pm2();
export default mcpserver.metas("/pm2")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口创建远端 PM2 进程。", schema: processValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await pm2.makeRemote(input); return { name: remote.name, path: remote.path }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查端口对应的 PM2 进程是否已存在。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await pm2.hasRemote(input.port) }) })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取端口对应的 PM2 进程标识和目录。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await pm2.getRemote(input.port); return { name: remote.name, path: remote.path }; } })
  .add({ protocol: "tool", path: "/refresh", description: "刷新端口对应的 PM2 进程状态。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: input => pm2.refresh(input.port) })
  .add({ protocol: "tool", path: "/stop", description: "停止端口对应的 PM2 进程。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await pm2.stop(input.port); return { stopped: true }; } })
  .add({ protocol: "tool", path: "/restart", description: "重启端口对应的 PM2 进程。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await pm2.restart(input.port); return { restarted: true }; } })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭端口对应的 PM2 进程。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await pm2.closeRemote(input.port); return { closed: true }; } });










