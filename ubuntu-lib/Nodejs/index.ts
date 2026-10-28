import Base from "../public/index.ts";
import store from "../store.ts";
import Ssh from "../ssh/index.ts";

export default class extends Base {
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    const { version, architecture, sha256 } = store.getState().nodejs;
    const archive = `node-v${version}-${architecture}.tar.xz`;
    const root = store.getState().nodejs.root;
    await ssh.execute(`set -e
if ! command -v curl >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1 || ! command -v xz >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends curl ca-certificates tar xz-utils >/dev/null
fi
if [ ! -x ${ssh.quoteShellArg(`${root}/bin/node`)} ]; then
  cd /tmp
  rm -f ${ssh.quoteShellArg(archive)}
  curl -fL --connect-timeout 15 --max-time 180 --retry 2 -o ${ssh.quoteShellArg(archive)} "https://nodejs.org/download/release/v${version}/${archive}"
  printf '%s  %s
' ${sha256} ${ssh.quoteShellArg(archive)} | sha256sum -c -
  rm -rf ${ssh.quoteShellArg(root)}
  mkdir -p ${ssh.quoteShellArg(root)}
  tar -xJf ${ssh.quoteShellArg(archive)} --strip-components=1 -C ${ssh.quoteShellArg(root)}
  rm -f ${ssh.quoteShellArg(archive)}
fi
for command in node npm npx corepack; do ln -sfn ${ssh.quoteShellArg(`${root}/bin`)}"/$command" "/usr/local/bin/$command"; done
node --version`);
  }


}
