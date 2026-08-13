import type Ssh from "../Ssh/index.ts";

export default abstract class Sftp {
  protected abstract readonly ssh: Ssh;

  /** 把本地文件上传到远端。 */
  public async remoteUpload(localPath: string, remotePath: string): Promise<void> {
    await this.ssh.isRunning();
    await this.ssh.client.putFile(localPath, remotePath);
  }

  /** 把本地目录递归上传到远端。 */
  public async remoteDirectoryUpload(
    localPath: string,
    remotePath: string,
    validate: (localPath: string) => boolean,
  ): Promise<void> {
    await this.ssh.isRunning();
    const isUploaded = await this.ssh.client.putDirectory(localPath, remotePath, {
      recursive: true,
      validate,
    });
    if (!isUploaded) throw new Error(`远端目录上传失败: ${remotePath}`);
  }

  /** 把远端文件下载到本地。 */
  public async locDownload(remotePath: string, localPath: string): Promise<void> {
    await this.ssh.isRunning();
    await this.ssh.client.getFile(localPath, remotePath);
  }
}
