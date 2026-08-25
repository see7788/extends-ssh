import mcpserver from "mcpserver";
import ubuntu from "ubuntu-lib/index.ts";
import { z } from "zod";

const emptyValidator = z.object({}).strict();
const mutate = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export default mcpserver.register.slice("docker").tool(
  "post",
  "/ensure",
  emptyValidator,
  "检查远端 Docker，缺少时完成安装与可用性验证。",
  mutate,
  async context => {
    await ubuntu.docker.isRemoteRunning();
    return context.json({ ready: true });
  },
);
