import Base from "../public/index.ts";
import Nginx from "../nginx/index.ts";
import store from "../store.ts";
import Ssh from "../ssh/index.ts";
import Vite from "../vite/index.ts";
import type { Plugin } from "vite";
export default class extends Base {
  async upload(localPath: string, remotePath: string): Promise<void> {
    await this.setupReady();
    const ssh = new Ssh();
    if (!await ssh.putDirectory(localPath, remotePath, { recursive: true, validate: () => true })) {
      throw new Error(`SFTP directory upload failed: ${remotePath}`);
    }
  }

  vitePlugin(port: number): Plugin {
    const vite = new Vite(port);
    const nginx = new Nginx("sftp", this.remotePath(port));
    let root!: string;
    return {
      name: `sftpPlugin${port}`,
      enforce: "pre",
      configResolved: async config => {
        root = config.root;
        vite.mergeState({
          sftp: { url: nginx.url },
        });
      },
      closeBundle: async () => {
        await this.makeRemote({ port, localPath: root });
        await nginx.makeRemote();
      },
    };
  }
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute("true");
  }
  async getRemote(port: number): Promise<{ readonly path: `/www/wwwroot/extends-ssh/${number}`; hasRemote(): Promise<boolean>; }> {
    await this.setupReady();
    if (!await this.hasRemote(port)) {
      throw new Error(`开发端口尚未分配 SFTP 远程目录: ${port}`);
    }
    return {
      path: this.remotePath(port),
      hasRemote: () => this.hasRemote(port),
    };
  };
  async hasRemote(port: number): Promise<boolean> {
    const remotePath = this.remotePath(port);
    await this.setupReady();
    const ssh = new Ssh();
    const markerPath = `${remotePath}/.extends-ssh-port`;
    const result = await ssh.execute(`test -f ${ssh.quoteShellArg(markerPath)} && cat ${ssh.quoteShellArg(markerPath)} || true`);
    return result.stdout.trim() === String(port);
  }
  async makeRemote(input: { port: number; localPath: string }): Promise<{ readonly path: `/www/wwwroot/extends-ssh/${number}`; hasRemote(): Promise<boolean>; }> {
    await this.makeRemoteEnsure(input);
    return {
      path: this.remotePath(input.port),
      hasRemote: () => this.hasRemote(input.port),
    };
  }
  private async makeRemoteEnsure(value: { port: number; localPath: string }): Promise<void> {
    await this.setupReady();
    const ssh = new Ssh();
    const remotePath = this.remotePath(value.port);
    const key = String(value.port);
    const markerPath = `${remotePath}/.extends-ssh-port`;
    const marker = await ssh.execute(`if [ -e ${ssh.quoteShellArg(remotePath)} ]; then if [ -f ${ssh.quoteShellArg(markerPath)} ]; then cat ${ssh.quoteShellArg(markerPath)}; else printf __occupied__; fi; fi`);
    const owner = marker.stdout.trim();
    if (owner === "__occupied__") throw new Error(`远程目录已被其他资源占用: ${remotePath}`);
    if (owner && owner !== key) throw new Error(`远程目录已被开发端口 ${owner} 占用: ${remotePath}`);
    if (!await ssh.putDirectory(value.localPath, remotePath, { recursive: true, validate: () => true })) {
      throw new Error(`SFTP directory upload failed: ${remotePath}`);
    }
    await ssh.execute(`printf %s ${ssh.quoteShellArg(key)} > ${ssh.quoteShellArg(markerPath)}`);
  }

  public remotePath(port: number): `/www/wwwroot/extends-ssh/${number}` {
    return `${store.getState().sftp.remoteRoot}/${port}`;
  }
}
