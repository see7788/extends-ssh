import type Ssh from "../Ssh/index.ts";

export default abstract class Apt {
  protected abstract readonly ssh: Ssh;
  private remoteRunningPromise?: Promise<void>;

  public isRemoteRunning(): Promise<void> {
    if (this.remoteRunningPromise) return this.remoteRunningPromise;
    const remoteRunningPromise = this.remoteRunningEnsure().finally(() => {
      if (this.remoteRunningPromise === remoteRunningPromise) {
        this.remoteRunningPromise = undefined;
      }
    });
    this.remoteRunningPromise = remoteRunningPromise;
    return remoteRunningPromise;
  }

  private async remoteRunningEnsure(): Promise<void> {
    await this.ssh.execute(`
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
`);
  }
}
