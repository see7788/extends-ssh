import mcpserver from "mcpserver";
import { apt } from "../Apt/index.ts";
import { ssh } from "../Ssh/index.ts";
import type Base from "../Public/Base.ts";

const nodeVersion = "22.23.2";
const architecture = "linux-x64";
const sha256 = "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307";

class Nodejs implements Base {
  private runningPromise?: Promise<void>;

  public remoteIsRunning(): Promise<void> {
    if (this.runningPromise) return this.runningPromise;
    const promise = this.ensure().finally(() => {
      if (this.runningPromise === promise) this.runningPromise = undefined;
    });
    this.runningPromise = promise;
    return promise;
  }

  private async ensure(): Promise<void> {
    await apt.remoteIsRunning();
    const archive = `node-v${nodeVersion}-${architecture}.tar.xz`;
    const root = `/opt/node-v${nodeVersion}-${architecture}`;
    const shell = (value: string) => `'${value.replace(/'/g, `\'"'"'`)}'`;
    await ssh.execute(`set -e
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
  handler: async () => { await nodejs.remoteIsRunning(); return { ready: true }; },
});







