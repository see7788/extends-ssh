import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import type { SSHExecCommandResponse } from "node-ssh";

type AptSlice = {
  aptActions: {
    isRemoteRunning(): Promise<void>;
  };
};

type SshDependency = {
  sshActions: {
    execute(command: string): Promise<SSHExecCommandResponse>;
  };
};

const s: immerStateCreator<AptSlice, SshDependency> = (_set, get) => {
  let running: Promise<void> | undefined;
  return {
    aptActions: {
      isRemoteRunning() {
        if (running) return running;
        const execution = get().sshActions.execute(`
set -e
test -x /usr/bin/apt-get
export DEBIAN_FRONTEND=noninteractive
PACKAGES="lsof net-tools unzip wget ufw sudo curl git ca-certificates gnupg lsb-release xz-utils iproute2"
MISSING=""
for PACKAGE in $PACKAGES; do
  if ! dpkg -s "$PACKAGE" >/dev/null 2>&1; then MISSING="$MISSING $PACKAGE"; fi
done
if [ -n "$MISSING" ]; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends $MISSING >/dev/null
fi
for COMMAND in lsof netstat unzip wget ufw sudo curl git gpg lsb_release xz ss; do
  command -v "$COMMAND" >/dev/null
done
`).then(() => undefined).finally(() => {
          if (running === execution) running = undefined;
        });
        running = execution;
        return execution;
      },
    },
  };
};

export default s;
