import type { NodeSSH } from "node-ssh";

export default class Sftp {
  constructor(
    private readonly ssh: NodeSSH,
    private readonly sshIsRunning: () => Promise<void>,
    private readonly sshDispose: () => void,
  ) {}

  /** 把本地文件上传到远端。 */
  public async remoteUpload(localPath: string, remotePath: string): Promise<void> {
    await this.sshIsRunning();
    await this.ssh.putFile(localPath, remotePath);
  }

  /** 把远端文件下载到本地。 */
  public async locDownload(remotePath: string, localPath: string): Promise<void> {
    await this.sshIsRunning();
    await this.ssh.getFile(localPath, remotePath);
  }

  /** 关闭当前 SFTP 对象共用的 SSH 会话。 */
  public dispose(): void {
    this.sshDispose();
  }
}
