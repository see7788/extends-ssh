import type Apt from "../Apt/index.ts";
import type Ssh from "../Ssh/index.ts";

export default abstract class Docker {
  protected abstract readonly apt: Apt;
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
    await this.apt.isRemoteRunning();
    await this.ssh.execute(`
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
  }
}
