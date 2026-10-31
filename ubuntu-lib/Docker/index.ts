import Base from "../public/index.ts";
import Ssh from "../ssh/index.ts";

export default class extends Base {
  async setup(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute(`
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
