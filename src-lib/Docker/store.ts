import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import type { SSHExecCommandResponse } from "node-ssh";

type DockerSlice = {
  DockerActions: {
    isRemoteRunning(): Promise<void>;
  };
};

type DockerDependencies = {
  AptActions: {
    isRemoteRunning(): Promise<void>;
  };
  SshActions: {
    execute(command: string): Promise<SSHExecCommandResponse>;
  };
};

const s: immerStateCreator<DockerSlice, DockerDependencies> = (_set, get) => {
  let running: Promise<void> | undefined;
  return {
    DockerActions: {
      isRemoteRunning() {
        if (running) return running;
        const execution = (async () => {
          await get().AptActions.isRemoteRunning();
          await get().SshActions.execute(`
set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends docker.io >/dev/null
fi
systemctl enable docker --now >/dev/null
systemctl is-active --quiet docker
docker info >/dev/null
`);
        })().finally(() => {
          if (running === execution) running = undefined;
        });
        running = execution;
        return execution;
      },
    },
  };
};

export default s;
