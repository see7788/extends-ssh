import mcpserver from "mcpserver";
import { apt } from "../Apt/index.ts";
import { emptyValidator, mutate, type McpJsonContext } from "../mcpBase.ts";
import { ssh } from "../Ssh/index.ts";

export default class Docker {
  protected readonly apt = apt;
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
    await this.apt.isRemoteRunning();
    await this.ssh.execute(`
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

export const docker = new Docker();

export const dockerSlice = mcpserver.metas("docker").tool(
  "post",
  "/ensure",
  emptyValidator,
  "检查远端 Docker，缺少时完成安装并验证可用性。",
  mutate,
  async (context: McpJsonContext<{}>) => {
    await docker.isRemoteRunning();
    return context.json({ ready: true });
  },
);
