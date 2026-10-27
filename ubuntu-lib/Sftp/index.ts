import Base from "../public/index.ts";
import store from "../store/index.ts";
import Ssh from "../ssh/index.ts";
type SftpDirectory = {
  readonly path: string;
  hasRemote(): Promise<boolean>;
};

export default class extends Base {
  vite(port: number, localPath: string) {
    return {
      state: { host: `${port}.${this.domain}` },
      actions: async () => {
        await this.makeRemote({ port, localPath });
        return async () => { };
      },
    };
  }
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute("true");
  }
  async getRemote(port: number): Promise<SftpDirectory> {
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
    const result = await ssh.execute(`test -f ${this.shell(markerPath)} && cat ${this.shell(markerPath)} || true`);
    return result.stdout.trim() === String(port);
  }
  async makeRemote(input: { port: number; localPath: string }): Promise<SftpDirectory> {
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
    const marker = await ssh.execute(`if [ -e ${this.shell(remotePath)} ]; then if [ -f ${this.shell(markerPath)} ]; then cat ${this.shell(markerPath)}; else printf __occupied__; fi; fi`);
    const owner = marker.stdout.trim();
    if (owner === "__occupied__") throw new Error(`远程目录已被其他资源占用: ${remotePath}`);
    if (owner && owner !== key) throw new Error(`远程目录已被开发端口 ${owner} 占用: ${remotePath}`);
    const uploaded = await ssh.putDirectory(value.localPath, remotePath, { recursive: true, validate: () => true });
    if (!uploaded) throw new Error(`远程目录同步失败: ${remotePath}`);
    await ssh.execute(`printf %s ${this.shell(key)} > ${this.shell(markerPath)}`);
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `\'"'"'`)}'`;
  }
  public remotePath(port: number): string {
    return `${store.getState().sftp.remoteRoot}/${port}`;
  }
}
