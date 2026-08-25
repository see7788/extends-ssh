import mcpserver from "mcpserver";
import ubuntu from "ubuntu-lib/index.ts";
import { sshExecuteValidator } from "ubuntu-lib/Ssh/index.ts";
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

export default mcpserver.register.slice("ssh")
  .tool(
    "post",
    "/config",
    emptyValidator,
    "读取 SSH 配置，仅返回主机、端口与用户名，绝不返回密码。",
    read,
    context => {
      const { host, port, username } = ubuntu.ssh.state;
      return context.json({ host, port, username });
    },
  )
  .tool(
    "post",
    "/state",
    emptyValidator,
    "读取当前 SSH 运行状态摘要，包含主机、端口、用户名与连接版本号。",
    read,
    context => {
      const { host, port, username } = ubuntu.ssh.state;
      return context.json({ host, port, username, revision: ubuntu.ssh.revision });
    },
  )
  .tool(
    "post",
    "/connect",
    emptyValidator,
    "建立并验证 SSH 连接，随后返回不含密码的连接状态摘要。",
    mutate,
    async context => {
      await ubuntu.ssh.isRunning();
      const { host, port, username } = ubuntu.ssh.state;
      return context.json({ host, port, username, revision: ubuntu.ssh.revision });
    },
  )
  .tool(
    "post",
    "/execute",
    sshExecuteValidator,
    "通过已经建立的 SSH 连接执行一条明确命令并返回执行结果。",
    mutate,
    async context => {
      const { command } = context.req.valid("json");
      return context.json(await ubuntu.ssh.execute(command));
    },
  )
  .tool(
    "post",
    "/dispose",
    emptyValidator,
    "关闭并释放当前 SSH 连接。",
    mutate,
    context => {
      ubuntu.ssh.dispose();
      return context.json({ disposed: true });
    },
  );
