import publicRuntime from "../Public/index.ts";

class Sftp {
  /** 把本地文件上传到远端。 */
  public async remoteUpload(localPath: string, remotePath: string): Promise<void> {
    await publicRuntime.sshIsRunning();
    await publicRuntime.ssh.putFile(localPath, remotePath);
  }

  /** 把远端文件下载到本地。 */
  public async locDownload(remotePath: string, localPath: string): Promise<void> {
    await publicRuntime.sshIsRunning();
    await publicRuntime.ssh.getFile(localPath, remotePath);
  }
}

export default new Sftp();
