import Base from "../public/Base.ts";
import mcpserver from "mcpserver";
import { ssh } from "../ssh/index.ts";

const nodeVersion = "22.23.2";
const architecture = "linux-x64";
const sha256 = "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307";

type Current = () => Promise<void>;

class Nodejs extends Base<Current> {
  readonly current: Current = async () => {
    await this.remoteIsRunning();
  };

  protected async remoteIsRunning(): Promise<void> {
    const archive = `node-v${nodeVersion}-${architecture}.tar.xz`;
    const root = `/opt/node-v${nodeVersion}-${architecture}`;
    const shell = (value: string) => `'${value.replace(/'/g, `\'"'"'`)}'`;
    await ssh.execute(`set -e
if ! command -v curl >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1 || ! command -v xz >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends curl ca-certificates tar xz-utils >/dev/null
fi
if [ ! -x ${shell(`${root}/bin/node`)} ]; then
  cd /tmp
  rm -f ${shell(archive)}
  curl -fL --connect-timeout 15 --max-time 180 --retry 2 -o ${shell(archive)} "https://nodejs.org/download/release/v${nodeVersion}/${archive}"
  printf '%s  %s\\n' ${sha256} ${shell(archive)} | sha256sum -c -
  rm -rf ${shell(root)}
  tar -xJf ${shell(archive)} -C /opt
  rm -f ${shell(archive)}
fi
for command in node npm npx corepack; do ln -sfn ${shell(`${root}/bin`)}"/$command" "/usr/local/bin/$command"; done
node --version`);
  }
}

export const nodejs = new Nodejs();

export default mcpserver.metas("/nodejs").add({
  protocol: "tool",
  path: "/ensure",
  description: "确保远端 Node.js 运行环境可用。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    await nodejs.current();
    return { ready: true };
  },
});
