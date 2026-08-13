import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import { posix } from "node:path";
import type { NodeSSH, SSHExecCommandResponse } from "node-ssh";

type SftpSlice = {
  SftpActions: {
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
  SshActions: {
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
    SftpActions: {
    async remoteUpload(localPath, remotePath) {
      await get().SshActions.isRunning();
      await get().SshActions.runtime().client.putFile(localPath, remotePath);
    },
    async remoteDirectoryUpload(localPath, remotePath, validate) {
      await get().SshActions.isRunning();
      const uploaded = await get().SshActions.runtime().client.putDirectory(
        localPath,
        remotePath,
        { recursive: true, validate },
      );
      if (!uploaded) throw new Error(`远端目录上传失败: ${remotePath}`);
    },
    async remoteDirectoryReplace(localPath, remotePath) {
      await get().SshActions.isRunning();
      const revision = `${process.pid}-${Date.now()}`;
      const incomingPath = `${remotePath}.incoming-${revision}`;
      const previousPath = `${remotePath}.previous-${revision}`;
      await get().SshActions.execute(`
set -e
rm -rf ${shell(incomingPath)} ${shell(previousPath)}
mkdir -p ${shell(incomingPath)}
`);
      try {
        await get().SftpActions.remoteDirectoryUpload(
          localPath,
          incomingPath,
          () => true,
        );
        await get().SshActions.execute(`
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
        await get().SshActions.execute(`rm -rf ${shell(incomingPath)}`)
          .catch(() => undefined);
        throw error;
      }
    },
    async remoteTextUpload(text, remotePath) {
      await get().SshActions.isRunning();
      const content = Buffer.from(text, "utf8").toString("base64");
      await get().SshActions.execute(`
set -e
mkdir -p ${shell(posix.dirname(remotePath))}
printf %s ${shell(content)} | base64 -d > ${shell(remotePath)}
`);
    },
    async remoteTextRead(remotePath) {
      await get().SshActions.isRunning();
      const response = await get().SshActions.execute(`
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
      await get().SshActions.isRunning();
      await get().SshActions.runtime().client.getFile(localPath, remotePath);
    },
  },
  };
};

export default s;
