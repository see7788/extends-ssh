import Base from "../public/index.ts";
import Ssh from "../ssh/index.ts";

export default class extends Base {
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
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
  }

  async hasRemote(): Promise<boolean> {
    const ssh = new Ssh();
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
