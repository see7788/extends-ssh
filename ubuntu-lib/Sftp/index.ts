import { isAbsolute, posix } from "node:path";
import type Ssh from "../Ssh/index.ts";
import { z } from "zod";

const localPathValidator = z.string().trim().min(1).refine(isAbsolute, {
  message: "localPath 必须是绝对路径",
});
const remotePathValidator = z.string().trim().min(1);

export const remoteUploadValidator = z.object({
  localPath: localPathValidator,
  remotePath: remotePathValidator,
}).strict();
export const remoteDirectoryUploadValidator = z.object({
  localPath: localPathValidator,
  remotePath: remotePathValidator,
}).strict();
export const remoteDirectoryReplaceValidator = z.object({
  localPath: localPathValidator,
  remotePath: remotePathValidator,
}).strict();
export const remoteTextUploadValidator = z.object({
  text: z.string(),
  remotePath: remotePathValidator,
}).strict();
export const remoteTextReadValidator = z.object({
  remotePath: remotePathValidator,
}).strict();
export const locDownloadValidator = z.object({
  remotePath: remotePathValidator,
  localPath: localPathValidator,
}).strict();

type RemoteUpload = z.infer<typeof remoteUploadValidator>;
type RemoteDirectoryUpload = z.infer<typeof remoteDirectoryUploadValidator>;
type RemoteDirectoryReplace = z.infer<typeof remoteDirectoryReplaceValidator>;
type RemoteTextUpload = z.infer<typeof remoteTextUploadValidator>;
type RemoteTextRead = z.infer<typeof remoteTextReadValidator>;
type LocDownload = z.infer<typeof locDownloadValidator>;

export default abstract class Sftp {
  protected abstract readonly ssh: Ssh;

  /** 把本地文件上传到远端。 */
  public async remoteUpload(
    localPath: RemoteUpload["localPath"],
    remotePath: RemoteUpload["remotePath"],
  ): Promise<void> {
    const input = remoteUploadValidator.parse({ localPath, remotePath });
    await this.ssh.isRunning();
    await this.ssh.client.putFile(input.localPath, input.remotePath);
  }

  /** 把本地目录递归上传到远端。 */
  public async remoteDirectoryUpload(
    localPath: RemoteDirectoryUpload["localPath"],
    remotePath: RemoteDirectoryUpload["remotePath"],
    validate: (localPath: string) => boolean,
  ): Promise<void> {
    const input = remoteDirectoryUploadValidator.parse({ localPath, remotePath });
    await this.ssh.isRunning();
    const isUploaded = await this.ssh.client.putDirectory(input.localPath, input.remotePath, {
      recursive: true,
      validate,
    });
    if (!isUploaded) throw new Error(`远端目录上传失败: ${input.remotePath}`);
  }

  /** 用本地目录完整替换远端目录，上传失败时保留原目录。 */
  public async remoteDirectoryReplace(
    localPath: RemoteDirectoryReplace["localPath"],
    remotePath: RemoteDirectoryReplace["remotePath"],
  ): Promise<void> {
    const input = remoteDirectoryReplaceValidator.parse({ localPath, remotePath });
    await this.ssh.isRunning();
    const revision = `${process.pid}-${Date.now()}`;
    const incomingPath = `${input.remotePath}.incoming-${revision}`;
    const previousPath = `${input.remotePath}.previous-${revision}`;
    await this.ssh.execute(`
set -e
rm -rf ${this.shell(incomingPath)} ${this.shell(previousPath)}
mkdir -p ${this.shell(incomingPath)}
`);
    try {
      await this.remoteDirectoryUpload(input.localPath, incomingPath, () => true);
      await this.ssh.execute(`
set -e
PREVIOUS=0
rollback() {
  STATUS=$?
  trap - ERR
  rm -rf ${this.shell(incomingPath)}
  if [ "$PREVIOUS" = 1 ] && [ ! -e ${this.shell(input.remotePath)} ]; then
    mv ${this.shell(previousPath)} ${this.shell(input.remotePath)}
  fi
  exit "$STATUS"
}
trap rollback ERR
mkdir -p ${this.shell(posix.dirname(input.remotePath))}
if [ -e ${this.shell(input.remotePath)} ] || [ -L ${this.shell(input.remotePath)} ]; then
  mv ${this.shell(input.remotePath)} ${this.shell(previousPath)}
  PREVIOUS=1
fi
mv ${this.shell(incomingPath)} ${this.shell(input.remotePath)}
rm -rf ${this.shell(previousPath)}
trap - ERR
`);
    } catch (error) {
      await this.ssh.execute(`rm -rf ${this.shell(incomingPath)}`).catch(() => undefined);
      throw error;
    }
  }

  /** 把文本内容写入远端文件。 */
  public async remoteTextUpload(
    text: RemoteTextUpload["text"],
    remotePath: RemoteTextUpload["remotePath"],
  ): Promise<void> {
    const input = remoteTextUploadValidator.parse({ text, remotePath });
    await this.ssh.isRunning();
    const content = Buffer.from(input.text, "utf8").toString("base64");
    await this.ssh.execute(`
set -e
mkdir -p ${this.shell(posix.dirname(input.remotePath))}
printf %s ${this.shell(content)} | base64 -d > ${this.shell(input.remotePath)}
`);
  }

  /** 读取远端文本文件；文件不存在时返回 undefined。 */
  public async remoteTextRead(
    remotePath: RemoteTextRead["remotePath"],
  ): Promise<string | undefined> {
    const input = remoteTextReadValidator.parse({ remotePath });
    await this.ssh.isRunning();
    const response = await this.ssh.execute(`
if [ -f ${this.shell(input.remotePath)} ]; then
  printf exists
  cat ${this.shell(input.remotePath)}
fi
`);
    return response.stdout.startsWith("exists") ? response.stdout.slice(6) : undefined;
  }

  /** 把远端文件下载到本地。 */
  public async locDownload(
    remotePath: LocDownload["remotePath"],
    localPath: LocDownload["localPath"],
  ): Promise<void> {
    const input = locDownloadValidator.parse({ remotePath, localPath });
    await this.ssh.isRunning();
    await this.ssh.client.getFile(input.localPath, input.remotePath);
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }
}
