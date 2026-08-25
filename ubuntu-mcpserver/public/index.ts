import mcpserver from "mcpserver";
import ubuntu from "ubuntu-lib/index.ts";
import { z } from "zod";

const emptyValidator = z.object({}).strict();
const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export default mcpserver.register.slice("public").tool(
  "post",
  "/state",
  emptyValidator,
  "读取公共域名与远端服务根目录。",
  read,
  context => context.json(ubuntu.public),
);
