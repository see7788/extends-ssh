import Base from "../public/index.ts";
import net from "node:net";
import Ssh from "../ssh/index.ts";
import Nginx from "../nginx/index.ts";
import Vite from "../vite/index.ts";
import type { Plugin } from "vite";
type Handle = { dispose(): Promise<void>; port: number };
type SshForwardResult = {
  readonly remotePort: number;
  hasRemote(): Promise<boolean>;
  close(): Promise<void>;
};

export default class extends Base {
  private handle?: Handle;
  constructor(private readonly port: number) {
    super();
  }
  vitePlugin(): Plugin {
    const nginx = new Nginx("sshForward", this.port);
    const vite = new Vite(this.port);
    return {
      name: `sshForwardPlugin${this.port}`,
      enforce: "pre",
      configResolved: async () => {
        vite.mergeState({
          sshForward: { url: nginx.url },
        });
      },
      configureServer: async () => {
        const forward = await this.getRemote();
        await nginx.makeRemote();
        return async () => {
          await forward.close();
          await nginx.closeRemote();
        };
      },
    };
  }
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute("true");
  }
  async makeRemote(): Promise<SshForwardResult> {
    await this.setupReady();
    await this.ensureForward();
    return {
      remotePort: this.handle!.port,
      hasRemote: () => this.hasRemote(),
      close: () => this.closeRemote(),
    };
  }
  async hasRemote(): Promise<boolean> {
    if (!this.handle) return false;
    return this.remotePortIsListening();
  }
  async getRemote(): Promise<SshForwardResult> {
    await this.setupReady();
    if (!await this.hasRemote()) {
      return this.makeRemote();
    }
    if (!this.handle) throw new Error("SSH 内网穿透句柄不存在");
    return {
      remotePort: this.handle.port,
      hasRemote: () => this.hasRemote(),
      close: () => this.closeRemote(),
    };
  }
  async closeRemote(): Promise<void> {
    const current = this.handle;
    if (!current) return;
    try {
      await current.dispose();
    } finally {
      this.handle = undefined;
    }
  }
  private async ensureForward(): Promise<void> {
    const ssh = new Ssh();
    const current = this.handle;
    if (current && await this.remotePortIsListening()) return;
    if (current) {
      try {
        await current.dispose();
      } finally {
        this.handle = undefined;
      }
    }
    if (await this.remotePortIsListening()) {
      throw new Error(`开发端口已被远程服务占用: ${this.port}`);
    }
    const handle = await ssh.forwardIn("0.0.0.0", this.port, (_details, accept, reject) => {
      const local = net.createConnection({ host: "127.0.0.1", port: this.port });
      const failed = () => { local.destroy(); reject(); };
      local.once("error", failed);
      local.once("connect", () => { local.off("error", failed); const remote = accept(); local.pipe(remote).pipe(local); });
    }) as Handle;
    this.handle = handle;
  }
  private async remotePortIsListening(): Promise<boolean> {
    const ssh = new Ssh();
    const result = await ssh.execute(`ss -ltnH | awk '$4 ~ /(^|:)${this.port}$/ { found=1 } END { print found ? "true" : "false" }'`);
    return result.stdout.trim() === "true";
  }
}
