import Base from "../public/Base.ts";
import mcpserver from "mcpserver";
import { z } from "zod";

import { nodejs } from "../nodejs/index.ts";
import { ssh } from "../ssh/index.ts";

const devPortValidator = z.number().int().min(1).max(65_535);
const remotePathValidator = z.string().trim().min(1).refine(value => value.startsWith("/") && !value.includes("\0") && !value.includes("\\"), "path 必须是 Linux 绝对路径");

const portValidator = devPortValidator;
const processValidator = z.object({
  port: portValidator,
  path: remotePathValidator,
  command: z.string().trim().min(1),
  environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
}).strict();
const inputValidator = z.object({ port: devPortValidator }).strict();
type Current = {
  readonly name: string;
  hasRemote(): Promise<boolean>;
  refresh(): Promise<"missing" | "stopped" | "running">;
  stop(): Promise<void>;
  restart(): Promise<void>;
  close(): Promise<void>;
};

class Pm2 extends Base<(input: z.infer<typeof processValidator>) => Promise<Current>> {
  readonly current = this.makeRemote.bind(this);

  protected async remoteIsRunning(): Promise<void> {
    await nodejs.current();
    await ssh.execute("set -e; command -v pm2 >/dev/null 2>&1 || npm install -g pm2; pm2 ping >/dev/null; pm2 save --force >/dev/null");
  }
  async getRemote(port: number): Promise<Current> {
    await this.remoteIsRunning();
    const value = inputValidator.parse({ port }).port;
    if (!await this.hasRemote(value)) {
      throw new Error(`开发端口尚未分配 PM2 进程: ${value}`);
    }
    return {
      name: String(value),
      hasRemote: () => this.hasRemote(value),
      refresh: () => this.refresh(value),
      stop: () => this.stop(value),
      restart: () => this.restart(value),
      close: () => this.closeRemote(value),
    };
  };
  async makeRemote(input: z.infer<typeof processValidator>): Promise<Current> {
    await this.remoteIsRunning();
    const value = processValidator.parse(input);
    const current = await this.refresh(value.port);
    if (current !== "running" && await this.remotePortIsListening(value.port)) {
      throw new Error(`开发端口已被其他远程服务占用: ${value.port}`);
    }
    const name = String(value.port);
    const environment = Object.entries(value.environment ?? {}).map(([key, item]) => `${key}=${this.shell(item)}`).join(" ");
    await ssh.execute(`set -e
pm2 delete ${this.shell(name)} >/dev/null 2>&1 || true
cd ${this.shell(value.path)}
${environment} pm2 start bash --name ${this.shell(name)} -- -lc ${this.shell(value.command)}
pm2 save --force >/dev/null`);
    return {
      name,
      hasRemote: () => this.hasRemote(value.port),
      refresh: () => this.refresh(value.port),
      stop: () => this.stop(value.port),
      restart: () => this.restart(value.port),
      close: () => this.closeRemote(value.port),
    };
  }
  async refresh(port: number): Promise<"missing" | "stopped" | "running"> {
    const value = inputValidator.parse({ port }).port;
    await this.remoteIsRunning();
    const result = await ssh.execute("pm2 jlist");
    const list: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(list)) throw new Error("PM2 未返回进程数组");
    const item = list.find((entry): entry is { name?: unknown; pm2_env?: { status?: unknown } } => typeof entry === "object" && entry !== null && (entry as { name?: unknown }).name === String(value));
    const status = item?.pm2_env?.status;
    return status === "online" ? "running" : item ? "stopped" : "missing";
  }
  async hasRemote(port: number): Promise<boolean> {
    return await this.refresh(port) !== "missing";
  }
  async stop(port: number): Promise<void> {
    const value = inputValidator.parse({ port }).port;
    await this.remoteIsRunning();
    const name = this.shell(String(value));
    await ssh.execute(`pm2 stop ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  async restart(port: number): Promise<void> {
    const value = inputValidator.parse({ port }).port;
    await this.remoteIsRunning();
    const name = this.shell(String(value));
    await ssh.execute(`pm2 restart ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  async closeRemote(port: number): Promise<void> {
    const value = inputValidator.parse({ port }).port;
    await this.remoteIsRunning();
    const name = this.shell(String(value));
    await ssh.execute(`pm2 delete ${name} >/dev/null 2>&1 || true; pm2 save --force >/dev/null`);
  }
  private async remotePortIsListening(port: number): Promise<boolean> {
    const result = await ssh.execute(`ss -ltnH | awk '$4 ~ /(^|:)${port}$/ { found=1 } END { print found ? "true" : "false" }'`);
    return result.stdout.trim() === "true";
  }
  private shell(value: string): string { return "'" + value.replace(/'/g, "'\"'\"'") + "'"; }
}

export const pm2 = new Pm2();
export default mcpserver.metas("/pm2")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口、远程目录和命令创建远端 PM2 进程。", schema: processValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await pm2.current(input); return { name: remote.name }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查端口对应的 PM2 进程是否已存在。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await pm2.hasRemote(input.port) }) })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取端口对应的 PM2 进程标识。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await pm2.getRemote(input.port); return { name: remote.name }; } })
  .add({ protocol: "tool", path: "/refresh", description: "刷新端口对应的 PM2 进程状态。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: input => pm2.refresh(input.port) })
  .add({ protocol: "tool", path: "/stop", description: "停止端口对应的 PM2 进程。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await pm2.stop(input.port); return { stopped: true }; } })
  .add({ protocol: "tool", path: "/restart", description: "重启端口对应的 PM2 进程。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await pm2.restart(input.port); return { restarted: true }; } })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭端口对应的 PM2 进程。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await pm2.closeRemote(input.port); return { closed: true }; } });
