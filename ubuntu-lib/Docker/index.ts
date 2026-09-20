import mcpserver from "mcpserver";
import { apt } from "../Apt/index.ts";
import { ssh } from "../Ssh/index.ts";

import type Base from "../Public/Base.ts";

class Docker implements Base {
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
    await apt.isRemoteRunning();
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

export const docker = new Docker();

export default mcpserver.metas("/docker").add({
    protocol: "tool",
    path: "/ensure",
    description: "检查远端 Docker，缺少时完成安装并验证可用性。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
    await docker.isRemoteRunning();
    return { ready: true };
  },
  });
