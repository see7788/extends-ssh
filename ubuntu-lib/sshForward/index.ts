import Base from "../public/index.ts";
import net from "node:net";
import Ssh from "../ssh/index.ts";
import Nginx from "../nginx/index.ts";
import Vite from "../vite/index.ts";
import type { Plugin } from "vite";
type Handle = { dispose(): Promise<void>; port: number };
type ForwardHandle = { handle: Handle };
type SshForwardResult = {
  readonly remotePort: number;
  hasRemote(): Promise<boolean>;
  close(): Promise<void>;
};

export default class extends Base {
  private readonly handles = new Map<number, ForwardHandle>();
  vitePlugin(port: number): Plugin {
    const nginx = new Nginx("sshForward");
    const vite = new Vite();
    return {
      name: `sshForwardPlugin${port}`,
      enforce: "pre",
      configResolved: async () => {
        vite.mergeState(port, {
          sshForward: { url: nginx.getUrl(port) },
        });
      },
      configureServer: async () => {
        const forward = await this.getRemote(port);
        return () => forward.close();
      },
    };
  }
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute("true");
  }
  async makeRemote(port: number): Promise<SshForwardResult> {
    await this.setupReady();
    await this.ensureForward(port);
    return {
      remotePort: this.handles.get(port)!.handle.port,
      hasRemote: () => this.hasRemote(port),
      close: () => this.closeRemote(port),
    };
  }
  async hasRemote(port: number): Promise<boolean> {
    const current = this.handles.get(port);
    if (!current) return false;
    return this.remotePortIsListening(port);
  }
  async getRemote(port: number): Promise<SshForwardResult> {
    await this.setupReady();
    if (!await this.hasRemote(port)) {
      return this.makeRemote(port);
    }
    const current = this.handles.get(port);
    if (!current) throw new Error(`SSH 内网穿透句柄不存在: ${port}`);
    return {
      remotePort: current.handle.port,
      hasRemote: () => this.hasRemote(port),
      close: () => this.closeRemote(port),
    };
  };
  async closeRemote(port: number): Promise<void> {
    const current = this.handles.get(port);
    if (!current) return;
    try {
      await current.handle.dispose();
    } finally {
      this.handles.delete(port);
    }
  }
  async dispose(): Promise<void> { await Promise.all([...this.handles.keys()].map(port => this.closeRemote(port))); }
  private async ensureForward(port: number): Promise<void> {
    const ssh = new Ssh();
    const current = this.handles.get(port);
    if (current && await this.remotePortIsListening(port)) return;
    if (current) {
      try {
        await current.handle.dispose();
      } finally {
        this.handles.delete(port);
      }
    }
    if (await this.remotePortIsListening(port)) {
      throw new Error(`开发端口已被远程服务占用: ${port}`);
    }
    const handle = await ssh.forwardIn("0.0.0.0", port, (_details, accept, reject) => {
      const local = net.createConnection({ host: "127.0.0.1", port });
      const failed = () => { local.destroy(); reject(); };
      local.once("error", failed);
      local.once("connect", () => { local.off("error", failed); const remote = accept(); local.pipe(remote).pipe(local); });
    }) as Handle;
    this.handles.set(port, { handle });
  }
  private async remotePortIsListening(port: number): Promise<boolean> {
    const ssh = new Ssh();
    const result = await ssh.execute(`ss -ltnH | awk '$4 ~ /(^|:)${port}$/ { found=1 } END { print found ? "true" : "false" }'`);
    return result.stdout.trim() === "true";
  }
}
