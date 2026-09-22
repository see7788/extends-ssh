import Base from "../public/Base.ts";
import mcpserver from "mcpserver";
import { z } from "zod";

import { nodejs } from "../nodejs/index.ts";
import { sftp } from "../sftp/index.ts";
import { sshForward } from "../sshForward/index.ts";
import store from "../store/index.ts";
import { ssh } from "../ssh/index.ts";

const devPortValidator = z.number().int().min(1).max(65_535);
const portValidator = devPortValidator
  .refine(port => {
    const { ssh, stunServer } = store.getState();
    return port !== 80
      && port !== 443
      && port !== ssh.port
      && port !== stunServer.port;
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

class Pm2 extends Base {
  protected async remoteIsRunning(): Promise<void> {
    await nodejs.remoteIsRunning();
    await ssh.execute("set -e; command -v pm2 >/dev/null 2>&1 || npm install -g pm2; pm2 ping >/dev/null; pm2 save --force >/dev/null");
  }
  async getRemote(port: number): Promise<Remote> {
    if (!await this.hasRemote(port)) {
      throw new Error(`开发端口尚未分配 PM2 进程: ${port}`);
    }
    return this.remote(port);
  }
  async makeRemote(input: z.infer<typeof processValidator>): Promise<Remote> {
    if (await sshForward.hasRemote(input.port)) throw new Error(`开发端口已被 SSH 内网穿透占用: ${input.port}`);
    await this.remoteIsRunning();
    const path = (await sftp.getRemote(input.port)).path;
    const current = await this.remoteStatus(input.port);
    if (current !== "running" && await this.remotePortIsListening(input.port)) {
      throw new Error(`开发端口已被其他远程服务占用: ${input.port}`);
    }
    const name = this.remoteDescription(input.port);
    const environment = Object.entries(input.environment ?? {}).map(([key, item]) => `${key}=${this.shell(item)}`).join(" ");
    await ssh.execute(`set -e
pm2 delete ${this.shell(name)} >/dev/null 2>&1 || true
cd ${this.shell(path)}
${environment} pm2 start bash --name ${this.shell(name)} -- -lc ${this.shell(input.command)}
pm2 save --force >/dev/null`);
      return this.remote(input.port);
  }
  private async remoteStatus(port: number): Promise<"missing" | "stopped" | "running"> {
    await this.remoteIsRunning();
    const result = await ssh.execute(`pm2 jlist`);
    const list: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(list)) throw new Error("PM2 未返回进程数组");
    const item = list.find((entry): entry is { name?: unknown; pm2_env?: { status?: unknown } } => typeof entry === "object" && entry !== null && (entry as { name?: unknown }).name === this.remoteDescription(port));
    const status = item?.pm2_env?.status;
    const normalized = status === "online" ? "running" : item ? "stopped" : "missing";
    return normalized;
  }
  async hasRemote(port: number): Promise<boolean> {
    return await this.remoteStatus(port) !== "missing" && await sftp.hasRemote(port);
  }
  async refresh(port: number): Promise<"missing" | "stopped" | "running"> { return this.remoteStatus(port); }
  async stop(port: number): Promise<void> {
    await this.remoteIsRunning();
    const name = this.shell(this.remoteDescription(port));
    await ssh.execute(`pm2 stop ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  async restart(port: number): Promise<void> {
    await this.remoteIsRunning();
    const name = this.shell(this.remoteDescription(port));
    await ssh.execute(`pm2 restart ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  async closeRemote(port: number): Promise<void> {
    await this.remoteIsRunning();
    const name = this.shell(this.remoteDescription(port));
    await ssh.execute(`pm2 delete ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  private async remotePortIsListening(port: number): Promise<boolean> {
    const result = await ssh.execute(`ss -ltnH | awk '$4 ~ /(^|:)${port}$/ { found=1 } END { print found ? "true" : "false" }'`);
    return result.stdout.trim() === "true";
  }
  private async remote(port: number): Promise<Remote> {
    const path = (await sftp.getRemote(port)).path;
    const name = this.remoteDescription(port);
    return {
      name,
      path,
      hasRemote: () => this.hasRemote(port),
      refresh: () => this.refresh(port),
      stop: () => this.stop(port),
      restart: () => this.restart(port),
      close: () => this.closeRemote(port),
    };
  }

  private shell(value: string): string { return "'" + value.replace(/'/g, "'\"'\"'") + "'"; }
  private remoteDescription(port: number): string {
    return String(port);
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










