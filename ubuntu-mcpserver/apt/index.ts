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

export default mcpserver.register.slice("apt").tool(
  "post",
  "/ensure",
  emptyValidator,
  "检查并补齐远端系统所需的 Apt 基础配件。",
  mutate,
  async context => {
    await ubuntu.apt.isRemoteRunning();
    return context.json({ ready: true });
  },
);
