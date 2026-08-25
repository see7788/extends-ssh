import mcpserver from "mcpserver";
import ubuntu from "ubuntu-lib/index.ts";
import {
  locDownloadValidator,
  remoteTextReadValidator,
  remoteTextUploadValidator,
  remoteUploadValidator,
} from "ubuntu-lib/Sftp/index.ts";

const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const mutate = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export default mcpserver.register.slice("sftp")
  .tool(
    "post",
    "/remoteUpload",
    remoteUploadValidator,
    "通过 SFTP 把一个本地文件上传到明确的远端路径。",
    mutate,
    async context => {
      const { localPath, remotePath } = context.req.valid("json");
      await ubuntu.sftp.remoteUpload(localPath, remotePath);
      return context.json({ uploaded: true });
    },
  )
  .tool(
    "post",
    "/remoteTextUpload",
    remoteTextUploadValidator,
    "通过 SFTP 把文本写入明确的远端文件。",
    mutate,
    async context => {
      const { text, remotePath } = context.req.valid("json");
      await ubuntu.sftp.remoteTextUpload(text, remotePath);
      return context.json({ uploaded: true });
    },
  )
  .tool(
    "post",
    "/remoteTextRead",
    remoteTextReadValidator,
    "通过 SFTP 读取明确的远端文本文件。",
    read,
    async context => context.json(
      await ubuntu.sftp.remoteTextRead(context.req.valid("json").remotePath),
    ),
  )
  .tool(
    "post",
    "/locDownload",
    locDownloadValidator,
    "通过 SFTP 把明确的远端文件下载到本地路径。",
    mutate,
    async context => {
      const { remotePath, localPath } = context.req.valid("json");
      await ubuntu.sftp.locDownload(remotePath, localPath);
      return context.json({ downloaded: true });
    },
  );
