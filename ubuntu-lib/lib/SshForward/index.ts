import net from "node:net";
import mcpserver from "mcpserver";
import { z } from "zod";

import store, { withPortLock } from "../store/index.ts";
import { ssh } from "../Ssh/index.ts";

const devPortValidator = z.number().int().min(1).max(9_999);



const inputValidator = z.object({ port: devPortValidator }).strict();
type Handle = { dispose(): Promise<void>; port: number };
type ForwardHandle = { handle: Handle; revision: number };
type Remote = {
  readonly host: string;
  readonly remotePort: number;
  hasRemote(): Promise<boolean>;
  close(): Promise<void>;
};
class SshForward {
  private readonly handles = new Map<number, ForwardHandle>();
  public makeRemote(port: number): Promise<Remote> {
    const value = inputValidator.parse({ port }).port;
    return withPortLock(value, async () => {
      await this.ensureForward(value);
      return this.remote(value);
    });
  }
  public async hasRemote(port: number): Promise<boolean> {
    const value = inputValidator.parse({ port }).port;
    const current = this.handles.get(value);
    if (!current) return false;
    await ssh.remoteIsRunning();
    if (current.revision !== ssh.revision) return false;
    return this.remotePortIsListening(value);
  }
  public async getRemote(port: number): Promise<Remote> {
    const value = inputValidator.parse({ port }).port;
    if (!await this.hasRemote(value)) {
      throw new Error(`开发端口尚未分配 SSH 内网穿透: ${value}`);
    }
    return this.remote(value);
  }
  public async closeRemote(port: number): Promise<void> {
    const value = inputValidator.parse({ port }).port;
    await withPortLock(value, async () => {
      await this.handles.get(value)?.handle.dispose().catch(() => undefined);
      this.handles.delete(value);
    });
  }
  public async dispose(): Promise<void> { await Promise.all([...this.handles.keys()].map(port => this.closeRemote(port))); }
  private async ensureForward(port: number): Promise<void> {
    const value = inputValidator.parse({ port }).port;
    const current = this.handles.get(value);
    await ssh.remoteIsRunning();
    if (current && current.revision === ssh.revision && await this.remotePortIsListening(value)) return;
    if (current) {
      await current.handle.dispose().catch(() => undefined);
      this.handles.delete(value);
    }
    const state = store.getState();
    if (value === 80 || value === 443 || value === state.ssh.port || value === state.stunServer.port) {
      throw new Error(`开发端口与固定服务端口冲突: ${value}`);
    }
    if (await this.remotePortIsListening(value)) {
      throw new Error(`开发端口已被远程服务占用: ${value}`);
    }
    const handle = await ssh.client.forwardIn("0.0.0.0", value, (_details, accept, reject) => {
      const local = net.createConnection({ host: "127.0.0.1", port: value });
      const failed = () => { local.destroy(); reject(); };
      local.once("error", failed);
      local.once("connect", () => { local.off("error", failed); const remote = accept(); local.pipe(remote).pipe(local); });
    }) as Handle;
    this.handles.set(value, { handle, revision: ssh.revision });
  }
  private remote(port: number): Remote {
    const current = this.handles.get(port);
    if (!current) throw new Error(`SSH 内网穿透句柄不存在: ${port}`);
    return {
      host: ssh.state.host,
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
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口建立 SSH 内网穿透", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await sshForward.makeRemote(input.port); return { host: remote.host, remotePort: remote.remotePort }; } })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的 SSH 内网穿透地址", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await sshForward.getRemote(input.port); return { host: remote.host, remotePort: remote.remotePort }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口当前的 SSH 内网穿透句柄及远程监听。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await sshForward.hasRemote(input.port) }) })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭开发端口对应的 SSH 内网穿透。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await sshForward.closeRemote(input.port); return { closed: true }; } })
  .add({ protocol: "tool", path: "/dispose", description: "关闭全部 SSH 内网穿透。", schema: {}, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async () => { await sshForward.dispose(); return { disposed: true }; } });












