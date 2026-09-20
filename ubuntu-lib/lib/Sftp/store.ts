import { posix } from "node:path";
import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { z } from "zod";

const defaultRemoteRoot = "/www/wwwroot/extends-ssh";
export const remoteRootValidator = z.string().trim().min(1).refine(
  value => value.startsWith("/") && !value.includes("\0") && !value.includes("\\") && posix.normalize(value) === value,
);

const sftpStore: ImmerStateCreator<{
  sftp: {
    remoteRoot: string;
  };
}> = () => ({
  sftp: {
    remoteRoot: defaultRemoteRoot,
  },
});

export default sftpStore;

