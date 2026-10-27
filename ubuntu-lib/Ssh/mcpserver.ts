import mcpserver from "mcpserver";
import Ssh from "./index.ts";
import { portValidator, sshExecuteValidator } from "./zod.ts";

const ssh = new Ssh();

export default mcpserver.metas("/ssh")
  .add({
    protocol: "tool",
    path: "/config",
    description: "读取 SSH 配置，仅返回主机、端口与用户名，绝不返回密码。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: input => ssh.config(),
  })
  .add({
    protocol: "tool",
    path: "/execute",
    description: "通过已经建立的 SSH 连接执行指定命令并返回执行结果。",
    schema: sshExecuteValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => await ssh.execute(input.command),
  })
  .add({
    protocol: "tool",
    path: "/hasPort",
    description: "查询远端端口是否被占用，并返回监听进程和项目路径。",
    schema: portValidator.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => ssh.hasPort(input.port),
  })
  .add({
    protocol: "tool",
    path: "/dispose",
    description: "关闭并释放当前 SSH 连接。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: input => {
      ssh.dispose();
      return { disposed: true };
    },
  });
