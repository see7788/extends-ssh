import Base from "../public/Base.ts";
import mcpserver from "mcpserver";
import { ssh } from "../ssh/index.ts";

type Current = () => Promise<void>;

class Apt extends Base<Current> {
  readonly current: Current = async () => {
    await this.remoteIsRunning();
  };

  protected remoteIsRunning(): Promise<void> {
    return this.ensureRemoteIsRunning(async () => {
      await ssh.execute(`
set -e
command -v apt-get >/dev/null 2>&1
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
    });
  }

  async hasRemote(): Promise<boolean> {
    const result = await ssh.execute(`
if ! command -v apt-get >/dev/null 2>&1 || ! command -v dpkg >/dev/null 2>&1; then
  printf false
  exit 0
fi
for PACKAGE in lsof net-tools unzip wget ufw sudo curl git ca-certificates gnupg lsb-release xz-utils iproute2; do
  if ! dpkg -s "$PACKAGE" >/dev/null 2>&1; then printf false; exit 0; fi
done
for COMMAND in lsof netstat unzip wget ufw sudo curl git gpg lsb_release xz ss; do
  if ! command -v "$COMMAND" >/dev/null 2>&1; then printf false; exit 0; fi
done
printf true`);
    return result.stdout.trim() === "true";
  }
}

export const apt = new Apt();

export default mcpserver.metas("/apt").add({
  protocol: "tool",
  path: "/ensure",
  description: "检查并补齐远端系统所需的 Apt 基础组件。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    await apt.current();
    return { ready: true };
  },
})
  .add({
    protocol: "tool",
    path: "/hasRemote",
    description: "检查远端 Apt 基础组件是否已经就绪，不执行安装。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => ({ hasRemote: await apt.hasRemote() }),
  });
