import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import { posix } from "node:path";
import type { NodeSSH, SSHExecCommandResponse } from "node-ssh";

type SftpSlice = {
  sftpActions: {
    remoteUpload(localPath: string, remotePath: string): Promise<void>;
    remoteDirectoryUpload(
      localPath: string,
      remotePath: string,
      validate: (localPath: string) => boolean,
    ): Promise<void>;
    remoteDirectoryReplace(localPath: string, remotePath: string): Promise<void>;
    remoteTextUpload(text: string, remotePath: string): Promise<void>;
    remoteTextRead(remotePath: string): Promise<string | undefined>;
    locDownload(remotePath: string, localPath: string): Promise<void>;
  };
};

type SshDependency = {
  sshActions: {
    isRunning(): Promise<void>;
    execute(command: string): Promise<SSHExecCommandResponse>;
    runtime(): {
      client: NodeSSH;
      revision: number;
    };
  };
};

const s: immerStateCreator<SftpSlice, SshDependency> = (_set, get) => {
  const shell = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
  return {
    sftpActions: {
    async remoteUpload(localPath, remotePath) {
      await get().sshActions.isRunning();
      await get().sshActions.runtime().client.putFile(localPath, remotePath);
    },
    async remoteDirectoryUpload(localPath, remotePath, validate) {
      await get().sshActions.isRunning();
      const uploaded = await get().sshActions.runtime().client.putDirectory(
        localPath,
        remotePath,
        { recursive: true, validate },
      );
      if (!uploaded) throw new Error(`远端目录上传失败: ${remotePath}`);
    },
    async remoteDirectoryReplace(localPath, remotePath) {
      await get().sshActions.isRunning();
      const revision = `${process.pid}-${Date.now()}`;
      const incomingPath = `${remotePath}.incoming-${revision}`;
      const previousPath = `${remotePath}.previous-${revision}`;
      await get().sshActions.execute(`
set -e
rm -rf ${shell(incomingPath)} ${shell(previousPath)}
mkdir -p ${shell(incomingPath)}
`);
      try {
        await get().sftpActions.remoteDirectoryUpload(
          localPath,
          incomingPath,
          () => true,
        );
        await get().sshActions.execute(`
set -e
PREVIOUS=0
rollback() {
  STATUS=$?
  trap - ERR
  rm -rf ${shell(incomingPath)}
  if [ "$PREVIOUS" = 1 ] && [ ! -e ${shell(remotePath)} ]; then
    mv ${shell(previousPath)} ${shell(remotePath)}
  fi
  exit "$STATUS"
}
trap rollback ERR
mkdir -p ${shell(posix.dirname(remotePath))}
if [ -e ${shell(remotePath)} ] || [ -L ${shell(remotePath)} ]; then
  mv ${shell(remotePath)} ${shell(previousPath)}
  PREVIOUS=1
fi
mv ${shell(incomingPath)} ${shell(remotePath)}
rm -rf ${shell(previousPath)}
trap - ERR
`);
      } catch (error) {
        await get().sshActions.execute(`rm -rf ${shell(incomingPath)}`)
          .catch(() => undefined);
        throw error;
      }
    },
    async remoteTextUpload(text, remotePath) {
      await get().sshActions.isRunning();
      const content = Buffer.from(text, "utf8").toString("base64");
      await get().sshActions.execute(`
set -e
mkdir -p ${shell(posix.dirname(remotePath))}
printf %s ${shell(content)} | base64 -d > ${shell(remotePath)}
`);
    },
    async remoteTextRead(remotePath) {
      await get().sshActions.isRunning();
      const response = await get().sshActions.execute(`
if [ -f ${shell(remotePath)} ]; then
  printf exists
  cat ${shell(remotePath)}
fi
`);
      return response.stdout.startsWith("exists")
        ? response.stdout.slice(6)
        : undefined;
    },
    async locDownload(remotePath, localPath) {
      await get().sshActions.isRunning();
      await get().sshActions.runtime().client.getFile(localPath, remotePath);
    },
  },
  };
};

export default s;
