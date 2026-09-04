import mcpserver from "mcpserver";
import { ssh } from "../Ssh/index.ts";
import { emptyValidator, mutate, type McpJsonContext } from "../mcpBase.ts";

export default class Apt {
  protected readonly ssh = ssh;
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

export const apt = new Apt();

export const aptSlice = mcpserver.metas("apt").tool(
  "post",
  "/ensure",
  emptyValidator,
  "检查并补齐远端系统所需的 Apt 基础组件。",
  mutate,
  async (context: McpJsonContext<{}>) => {
    await apt.isRemoteRunning();
    return context.json({ ready: true });
  },
);
