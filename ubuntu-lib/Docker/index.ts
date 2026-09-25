import Base from "../public/Base.ts";
import mcpserver from "mcpserver";
import { ssh } from "../ssh/index.ts";

type Current = () => Promise<void>;

class Docker extends Base<Current> {
  readonly current: Current = async () => {
    await this.remoteIsRunning();
  };

  protected remoteIsRunning(): Promise<void> {
    return this.ensureRemoteIsRunning(async () => {
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
    });
  }

  async hasRemote(): Promise<boolean> {
    const result = await ssh.execute("if command -v docker >/dev/null 2>&1 && systemctl is-active --quiet docker && docker info >/dev/null 2>&1; then printf true; else printf false; fi");
    return result.stdout.trim() === "true";
  }
}

export const docker = new Docker();

export default mcpserver.metas("/docker").add({
  protocol: "tool",
  path: "/ensure",
  description: "检查远端 Docker，缺少时完成安装并验证可用性。",
  schema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    await docker.current();
    return { ready: true };
  },
})
  .add({
    protocol: "tool",
    path: "/hasRemote",
    description: "检查远端 Docker 是否已经运行，不执行安装。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async () => ({ hasRemote: await docker.hasRemote() }),
  });
