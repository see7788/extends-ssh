import Base from "../public/index.ts";
import store from "../store/index.ts";
import Ssh from "../ssh/index.ts";

export default class extends Base {
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    const { version, architecture, sha256 } = store.getState().nodejs;
    const archive = `node-v${version}-${architecture}.tar.xz`;
    const root = store.getState().nodejs.root;
    const shell = (value: string) => `'${value.replace(/'/g, `\'"'"'`)}'`;
    await ssh.execute(`set -e
if ! command -v curl >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1 || ! command -v xz >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends curl ca-certificates tar xz-utils >/dev/null
fi
if [ ! -x ${shell(`${root}/bin/node`)} ]; then
  cd /tmp
  rm -f ${shell(archive)}
  curl -fL --connect-timeout 15 --max-time 180 --retry 2 -o ${shell(archive)} "https://nodejs.org/download/release/v${version}/${archive}"
  printf '%s  %s
' ${sha256} ${shell(archive)} | sha256sum -c -
  rm -rf ${shell(root)}
  mkdir -p ${shell(root)}
  tar -xJf ${shell(archive)} --strip-components=1 -C ${shell(root)}
  rm -f ${shell(archive)}
fi
for command in node npm npx corepack; do ln -sfn ${shell(`${root}/bin`)}"/$command" "/usr/local/bin/$command"; done
node --version`);
  }

  async hasRemote(): Promise<boolean> {
    const ssh = new Ssh();
    const { root } = store.getState().nodejs;
    const shell = (value: string) => `'${value.replace(/'/g, `\'"'"'`)}'`;
    const result = await ssh.execute(`if [ -x ${shell(`${root}/bin/node`)} ] \
  && [ -x ${shell(`${root}/bin/npm`)} ] \
  && [ -x ${shell(`${root}/bin/npx`)} ]; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }
}
