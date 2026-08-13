import type Ssh from "../Ssh/index.ts";

export default abstract class Pm2 {
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
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo '远程服务器缺少 Node.js 与 npm' >&2
  exit 1
fi
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
pm2 ping >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null
systemctl enable pm2-root >/dev/null
`);
  }
}
