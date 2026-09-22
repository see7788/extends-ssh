import Base from "../public/Base.ts";
import mcpserver from "mcpserver";
import { ssh } from "../ssh/index.ts";

class Apt extends Base {
  async remoteIsRunning(): Promise<void> {
    await ssh.execute(`
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

export default mcpserver.metas("/apt").add({
  protocol: "tool",
  path: "/ensure",
  description: "检查并补齐远端系统所需的 Apt 基础组件。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async input => {
    await apt.remoteIsRunning();
    return { ready: true };
  },
});





