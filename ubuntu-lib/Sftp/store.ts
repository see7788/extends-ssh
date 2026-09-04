import { posix } from "node:path";
import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { z } from "zod";

const defaultRemoteRoot = "/www/wwwroot/extends-ssh";
export const remoteRootValidator = z
  .string()
  .trim()
  .min(1)
  .refine(
    value => value.startsWith("/")
      && !value.includes("\0")
      && !value.includes("\\")
      && posix.normalize(value) === value,
    { message: "remoteRoot 必须是规范化的 Linux 绝对路径" },
  );

export const sftpValidator = z.object({
  sftp: z.object({
    remoteRoot: remoteRootValidator,
  }).strict(),
}).strict();

type SftpStore = z.infer<typeof sftpValidator>;

const sftpStore: ImmerStateCreator<SftpStore> = () => sftpValidator.parse({
  sftp: {
    remoteRoot: defaultRemoteRoot,
  },
});

export default sftpStore;
