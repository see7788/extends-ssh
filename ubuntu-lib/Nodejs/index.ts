import type Apt from "../Apt/index.ts";
import type Ssh from "../Ssh/index.ts";

export default abstract class Nodejs {
  protected abstract readonly apt: Apt;
  protected abstract readonly ssh: Ssh;
  private readonly configuration = {
    version: "22.23.2",
    architecture: "linux-x64",
    sha256: "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307",
  } as const;
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
    const { version, architecture, sha256 } = this.configuration;
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new TypeError(`Node.js 版本无效: ${version}`);
    }
    if (architecture !== "linux-x64") {
      throw new TypeError(`Node.js 架构无效: ${architecture}`);
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new TypeError(`Node.js SHA-256 无效: ${sha256}`);
    }
    await this.apt.isRemoteRunning();
    const archive = `node-v${version}-${architecture}.tar.xz`;
    const nodeRoot = `/opt/node-v${version}-${architecture}`;
    await this.ssh.execute(`
set -e
NODE_VERSION=${version}
NODE_ARCHIVE=${archive}
NODE_ROOT=${nodeRoot}
if [ ! -x "$NODE_ROOT/bin/node" ]; then
  cd /tmp
  rm -f "$NODE_ARCHIVE"
  curl -fL --connect-timeout 15 --max-time 180 --retry 2 -o "$NODE_ARCHIVE" \
    "https://npmmirror.com/mirrors/node/v$NODE_VERSION/$NODE_ARCHIVE" || \
  curl -fL --connect-timeout 15 --max-time 180 --retry 2 -o "$NODE_ARCHIVE" \
    "https://nodejs.org/download/release/v$NODE_VERSION/$NODE_ARCHIVE"
  printf '%s  %s\n' ${sha256} "$NODE_ARCHIVE" | sha256sum -c -
  rm -rf "$NODE_ROOT"
  tar -xJf "$NODE_ARCHIVE" -C /opt
  rm -f "$NODE_ARCHIVE"
fi
for COMMAND in node npm npx corepack; do
  test -x "$NODE_ROOT/bin/$COMMAND"
  ln -sfn "$NODE_ROOT/bin/$COMMAND" "/usr/local/bin/$COMMAND"
done
/usr/local/bin/node -e "if (process.versions.node !== '$NODE_VERSION') process.exit(1)"
/usr/local/bin/npm --version >/dev/null
`);
  }
}
