import { isAbsolute, posix } from "node:path";
import mcpserver from "mcpserver";
import { ssh } from "../Ssh/index.ts";
import store from "../store/index.ts";
import { remoteRootValidator } from "./store.ts";
import { z } from "zod";

const localPathValidator = z.string().trim().min(1).refine(isAbsolute, {
  message: "localPath 必须是绝对路径",
});
const remotePathValidator = z.string().trim().min(1);
const remotePathNameValidator = z.string().trim().regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  { message: "远端目录名称无效" },
);

const remotePathResolveValidator = z.object({
  name: remotePathNameValidator,
}).strict();
const remoteExecuteValidator = z.object({
  command: z.string().trim().min(1),
}).strict();

const remoteUploadValidator = z.object({
  localPath: localPathValidator,
  remotePath: remotePathValidator,
}).strict();
const remoteDirectoryUploadValidator = z.object({
  localPath: localPathValidator,
  remotePath: remotePathValidator,
}).strict();
const remoteDirectoryReplaceValidator = z.object({
  localPath: localPathValidator,
  remotePath: remotePathValidator,
}).strict();
const remoteTextUploadValidator = z.object({
  text: z.string(),
  remotePath: remotePathValidator,
}).strict();
const remoteTextReadValidator = z.object({
  remotePath: remotePathValidator,
}).strict();
const locDownloadValidator = z.object({
  remotePath: remotePathValidator,
  localPath: localPathValidator,
}).strict();

type DirectoryUploadValidate = NonNullable<
  NonNullable<Parameters<typeof ssh.client.putDirectory>[2]>["validate"]
>;

import type Base from "../Public/Base.ts";

class Sftp implements Base {
  private remoteRunningPromise?: Promise<void>;

  public isRemoteRunning(): Promise<void> {
    if (this.remoteRunningPromise) return this.remoteRunningPromise;
    const remoteRunningPromise = ssh.isRemoteRunning().finally(() => {
      if (this.remoteRunningPromise === remoteRunningPromise) {
        this.remoteRunningPromise = undefined;
      }
    });
    this.remoteRunningPromise = remoteRunningPromise;
    return remoteRunningPromise;
  }

  public get remoteRoot(): string {
    return remoteRootValidator.parse(store.getState().sftp.remoteRoot);
  }

  public get state() {
    return { remoteRoot: this.remoteRoot };
  }

  /** 根据持久化根目录解析一个应用目录。 */
  public remotePath(input: z.infer<typeof remotePathResolveValidator>): string {
    const value = remotePathResolveValidator.parse(input);
    return posix.join(this.remoteRoot, value.name);
  }

  /** 应用目录相关的远端命令统一从 SFTP 文件边界执行。 */
  public remoteExecute(input: z.infer<typeof remoteExecuteValidator>) {
    const value = remoteExecuteValidator.parse(input);
    return ssh.execute(value.command);
  }

  /** 把本地文件上传到远端。 */
  public async remoteUpload(
    input: z.infer<typeof remoteUploadValidator>,
  ): Promise<void> {
    const value = remoteUploadValidator.parse(input);
    await this.isRemoteRunning();
    await ssh.client.putFile(value.localPath, value.remotePath);
  }

  /** 把本地目录递归上传到远端。 */
  public async remoteDirectoryUpload<Validate extends DirectoryUploadValidate>(
    input: z.infer<typeof remoteDirectoryUploadValidator> & { validate: Validate },
  ): Promise<void> {
    const { validate, ...uploadInput } = input;
    const value = remoteDirectoryUploadValidator.parse(uploadInput);
    await this.isRemoteRunning();
    const isUploaded = await ssh.client.putDirectory(value.localPath, value.remotePath, {
      recursive: true,
      validate,
    });
    if (!isUploaded) throw new Error(`远端目录上传失败: ${value.remotePath}`);
  }

  /** 用本地目录完整替换远端目录，上传失败时保留原目录。 */
  public async remoteDirectoryReplace(
    input: z.infer<typeof remoteDirectoryReplaceValidator>,
  ): Promise<void> {
    const value = remoteDirectoryReplaceValidator.parse(input);
    await this.isRemoteRunning();
    const revision = `${process.pid}-${Date.now()}`;
    const incomingPath = `${value.remotePath}.incoming-${revision}`;
    const previousPath = `${value.remotePath}.previous-${revision}`;
    await ssh.execute(`
set -e
rm -rf ${this.shell(incomingPath)} ${this.shell(previousPath)}
mkdir -p ${this.shell(incomingPath)}
`);
    try {
      await this.remoteDirectoryUpload({
        localPath: value.localPath,
        remotePath: incomingPath,
        validate: () => true,
      });
      await ssh.execute(`
set -e
PREVIOUS=0
rollback() {
  STATUS=$?
  trap - ERR
  rm -rf ${this.shell(incomingPath)}
  if [ "$PREVIOUS" = 1 ] && [ ! -e ${this.shell(value.remotePath)} ]; then
    mv ${this.shell(previousPath)} ${this.shell(value.remotePath)}
  fi
  exit "$STATUS"
}
trap rollback ERR
mkdir -p ${this.shell(posix.dirname(value.remotePath))}
if [ -e ${this.shell(value.remotePath)} ] || [ -L ${this.shell(value.remotePath)} ]; then
  mv ${this.shell(value.remotePath)} ${this.shell(previousPath)}
  PREVIOUS=1
fi
mv ${this.shell(incomingPath)} ${this.shell(value.remotePath)}
rm -rf ${this.shell(previousPath)}
trap - ERR
`);
    } catch (error) {
      await ssh.execute(`rm -rf ${this.shell(incomingPath)}`).catch(() => undefined);
      throw error;
    }
  }

  /** 把文本内容写入远端文件。 */
  public async remoteTextUpload(
    input: z.infer<typeof remoteTextUploadValidator>,
  ): Promise<void> {
    const value = remoteTextUploadValidator.parse(input);
    await this.isRemoteRunning();
    const content = Buffer.from(value.text, "utf8").toString("base64");
    await ssh.execute(`
set -e
mkdir -p ${this.shell(posix.dirname(value.remotePath))}
printf %s ${this.shell(content)} | base64 -d > ${this.shell(value.remotePath)}
`);
  }

  /** 读取远端文本文件；文件不存在时返回 undefined。 */
  public async remoteTextRead(
    input: z.infer<typeof remoteTextReadValidator>,
  ): Promise<string | undefined> {
    const value = remoteTextReadValidator.parse(input);
    await this.isRemoteRunning();
    const response = await ssh.execute(`
if [ -f ${this.shell(value.remotePath)} ]; then
  printf exists
  cat ${this.shell(value.remotePath)}
fi
`);
    return response.stdout.startsWith("exists") ? response.stdout.slice(6) : undefined;
  }

  /** 把远端文件下载到本地。 */
  public async locDownload(
    input: z.infer<typeof locDownloadValidator>,
  ): Promise<void> {
    const value = locDownloadValidator.parse(input);
    await this.isRemoteRunning();
    await ssh.client.getFile(value.localPath, value.remotePath);
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }
}

export const sftp = new Sftp();

export default mcpserver.metas("/sftp")
  .add({
    protocol: "tool",
    path: "/state",
    description: "读取 SFTP 远程根目录。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: input => sftp.state,
  })
  .add({
    protocol: "tool",
    path: "/remotePath",
    description: "解析 SFTP 持久化的远程应用目录。",
    schema: remotePathResolveValidator.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: input => {
      return { remotePath: sftp.remotePath(input) };
    },
  })
  .add({
    protocol: "tool",
    path: "/remoteUpload",
    description: "通过 SFTP 把本地文件上传到指定的远程路径。",
    schema: remoteUploadValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      const { localPath, remotePath } = input;
      await sftp.remoteUpload({ localPath, remotePath });
      return { uploaded: true };
    },
  })
  .add({
    protocol: "tool",
    path: "/remoteTextUpload",
    description: "通过 SFTP 把文本写入指定的远程文件。",
    schema: remoteTextUploadValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      const { text, remotePath } = input;
      await sftp.remoteTextUpload({ text, remotePath });
      return { uploaded: true };
    },
  })
  .add({
    protocol: "tool",
    path: "/remoteTextRead",
    description: "通过 SFTP 读取指定的远程文本文件。",
    schema: remoteTextReadValidator.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async input => await sftp.remoteTextRead(input),
  })
  .add({
    protocol: "tool",
    path: "/locDownload",
    description: "通过 SFTP 把指定的远程文件下载到本地路径。",
    schema: locDownloadValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      const { remotePath, localPath } = input;
      await sftp.locDownload({ remotePath, localPath });
      return { downloaded: true };
    },
  });
