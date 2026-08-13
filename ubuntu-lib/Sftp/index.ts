import { posix } from "node:path";
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

  /** 用本地目录完整替换远端目录，上传失败时保留原目录。 */
  public async remoteDirectoryReplace(localPath: string, remotePath: string): Promise<void> {
    await this.ssh.isRunning();
    const revision = `${process.pid}-${Date.now()}`;
    const incomingPath = `${remotePath}.incoming-${revision}`;
    const previousPath = `${remotePath}.previous-${revision}`;
    await this.ssh.execute(`
set -e
rm -rf ${this.shell(incomingPath)} ${this.shell(previousPath)}
mkdir -p ${this.shell(incomingPath)}
`);
    try {
      await this.remoteDirectoryUpload(localPath, incomingPath, () => true);
      await this.ssh.execute(`
set -e
PREVIOUS=0
rollback() {
  STATUS=$?
  trap - ERR
  rm -rf ${this.shell(incomingPath)}
  if [ "$PREVIOUS" = 1 ] && [ ! -e ${this.shell(remotePath)} ]; then
    mv ${this.shell(previousPath)} ${this.shell(remotePath)}
  fi
  exit "$STATUS"
}
trap rollback ERR
mkdir -p ${this.shell(posix.dirname(remotePath))}
if [ -e ${this.shell(remotePath)} ] || [ -L ${this.shell(remotePath)} ]; then
  mv ${this.shell(remotePath)} ${this.shell(previousPath)}
  PREVIOUS=1
fi
mv ${this.shell(incomingPath)} ${this.shell(remotePath)}
rm -rf ${this.shell(previousPath)}
trap - ERR
`);
    } catch (error) {
      await this.ssh.execute(`rm -rf ${this.shell(incomingPath)}`).catch(() => undefined);
      throw error;
    }
  }

  /** 把文本内容写入远端文件。 */
  public async remoteTextUpload(text: string, remotePath: string): Promise<void> {
    await this.ssh.isRunning();
    const content = Buffer.from(text, "utf8").toString("base64");
    await this.ssh.execute(`
set -e
mkdir -p ${this.shell(posix.dirname(remotePath))}
printf %s ${this.shell(content)} | base64 -d > ${this.shell(remotePath)}
`);
  }

  /** 读取远端文本文件；文件不存在时返回 undefined。 */
  public async remoteTextRead(remotePath: string): Promise<string | undefined> {
    await this.ssh.isRunning();
    const response = await this.ssh.execute(`
if [ -f ${this.shell(remotePath)} ]; then
  printf exists
  cat ${this.shell(remotePath)}
fi
`);
    return response.stdout.startsWith("exists") ? response.stdout.slice(6) : undefined;
  }

  /** 把远端文件下载到本地。 */
  public async locDownload(remotePath: string, localPath: string): Promise<void> {
    await this.ssh.isRunning();
    await this.ssh.client.getFile(localPath, remotePath);
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }
}
