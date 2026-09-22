import Base from "../public/Base.ts";
import net from "node:net";
import mcpserver from "mcpserver";
import { z } from "zod";
import store from "../store/index.ts";
import { ssh } from "../ssh/index.ts";
const devPortValidator = z.number().int().min(1).max(65_535);

const inputValidator = z.object({ port: devPortValidator }).strict();
type Handle = { dispose(): Promise<void>; port: number };
type ForwardHandle = { handle: Handle };
type Remote = {
  readonly remotePort: number;
  hasRemote(): Promise<boolean>;
  close(): Promise<void>;
};
class SshForward extends Base {
  private readonly handles = new Map<number, ForwardHandle>();
  protected async remoteIsRunning(): Promise<void> {
    await ssh.execute("true");
  }
  async makeRemote(port: number): Promise<Remote> {
    await this.ensureForward(port);
    return this.remote(port);
  }
  async hasRemote(port: number): Promise<boolean> {
    const current = this.handles.get(port);
    if (!current) return false;
    return this.remotePortIsListening(port);
  }
  async getRemote(port: number): Promise<Remote> {
    if (!await this.hasRemote(port)) {
      throw new Error(`开发端口尚未分配 SSH 内网穿透: ${port}`);
    }
    return this.remote(port);
  }
  async closeRemote(port: number): Promise<void> {
    await this.handles.get(port)?.handle.dispose().catch(() => undefined);
    this.handles.delete(port);
  }
  async dispose(): Promise<void> { await Promise.all([...this.handles.keys()].map(port => this.closeRemote(port))); }
  private async ensureForward(port: number): Promise<void> {
    const current = this.handles.get(port);
    await this.remoteIsRunning();
    if (current && await this.remotePortIsListening(port)) return;
    if (current) {
      await current.handle.dispose().catch(() => undefined);
      this.handles.delete(port);
    }
    const { ssh: sshState, stunServer } = store.getState();
    if (port === 80 || port === 443 || port === sshState.port || port === stunServer.port) {
      throw new Error(`开发端口与固定服务端口冲突: ${port}`);
    }
    if (await this.remotePortIsListening(port)) {
      throw new Error(`开发端口已被远程服务占用: ${port}`);
    }
    const handle = await ssh.client.forwardIn("0.0.0.0", port, (_details, accept, reject) => {
      const local = net.createConnection({ host: "127.0.0.1", port });
      const failed = () => { local.destroy(); reject(); };
      local.once("error", failed);
      local.once("connect", () => { local.off("error", failed); const remote = accept(); local.pipe(remote).pipe(local); });
    }) as Handle;
    this.handles.set(port, { handle });
  }
  private remote(port: number): Remote {
    const current = this.handles.get(port);
    if (!current) throw new Error(`SSH 内网穿透句柄不存在: ${port}`);
    return {
      remotePort: current.handle.port,
      hasRemote: () => this.hasRemote(port),
      close: () => this.closeRemote(port),
    };
  }
  private async remotePortIsListening(port: number): Promise<boolean> {
    const result = await ssh.execute(`ss -ltnH | awk '$4 ~ /(^|:)${port}$/ { found=1 } END { print found ? "true" : "false" }'`);
    return result.stdout.trim() === "true";
  }
}

export const sshForward = new SshForward();

export default mcpserver.metas("/sshForward")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口建立 SSH 远端端口转发", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await sshForward.makeRemote(input.port); return { remotePort: remote.remotePort }; } })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的 SSH 远端端口", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await sshForward.getRemote(input.port); return { remotePort: remote.remotePort }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口当前的 SSH 内网穿透句柄及远程监听。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await sshForward.hasRemote(input.port) }) })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭开发端口对应的 SSH 内网穿透。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await sshForward.closeRemote(input.port); return { closed: true }; } })
  .add({ protocol: "tool", path: "/dispose", description: "关闭全部 SSH 内网穿透。", schema: {}, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async () => { await sshForward.dispose(); return { disposed: true }; } });












