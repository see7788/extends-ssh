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
const mutate = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export default mcpserver.register.slice("stunServer")
  .tool(
    "post",
    "/state",
    emptyValidator,
    "读取 STUN 服务的公开连接数据。",
    read,
    context => context.json(ubuntu.stunServer.state),
  )
  .tool(
    "post",
    "/ensure",
    emptyValidator,
    "检查并确保远端 STUN 服务处于可用状态。",
    mutate,
    async context => {
      await ubuntu.stunServer.isRemoteRunning();
      return context.json({ ready: true });
    },
  );
