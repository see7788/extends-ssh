import mcpserver from "mcpserver";
import ubuntu from "ubuntu-lib/index.ts";
import {
  idValidator,
  processIsRemoteRunningValidator,
  processRemoteCloseValidator,
} from "ubuntu-lib/Pm2/index.ts";
import { z } from "zod";

const emptyValidator = z.object({}).strict();
const localRead = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const remoteRead = { ...localRead, openWorldHint: true } as const;
const mutate = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export default mcpserver.register.slice("pm2")
  .tool(
    "post",
    "/state",
    emptyValidator,
    "读取当前缓存的 PM2 进程状态。",
    localRead,
    context => context.json(ubuntu.pm2.state),
  )
  .tool(
    "post",
    "/refresh",
    emptyValidator,
    "从远端重新读取 PM2 进程并刷新状态。",
    remoteRead,
    async context => context.json(await ubuntu.pm2.refresh()),
  )
  .tool(
    "post",
    "/stop",
    idValidator,
    "按 PM2 进程编号停止一个远端进程。",
    mutate,
    async context => context.json(await ubuntu.pm2.stop(context.req.valid("json").id)),
  )
  .tool(
    "post",
    "/restart",
    idValidator,
    "按 PM2 进程编号重启一个远端进程。",
    mutate,
    async context => context.json(await ubuntu.pm2.restart(context.req.valid("json").id)),
  )
  .tool(
    "post",
    "/processIsRemoteRunning",
    processIsRemoteRunningValidator,
    "按名称启动 PM2 进程，并验证其目标端口已经可用。",
    mutate,
    async context => {
      await ubuntu.pm2.processIsRemoteRunning(context.req.valid("json"));
      return context.json({ started: true });
    },
  )
  .tool(
    "post",
    "/processRemoteClose",
    processRemoteCloseValidator,
    "按名称停止一个远端 PM2 进程。",
    mutate,
    async context => {
      await ubuntu.pm2.processRemoteClose(context.req.valid("json").name);
      return context.json({ stopped: true });
    },
  );
