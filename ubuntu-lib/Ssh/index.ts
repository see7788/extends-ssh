import { NodeSSH, type SSHExecCommandResponse } from "node-ssh";
import mcpserver from "mcpserver";
import { emptyValidator, mutate, read, type McpJsonContext } from "../mcpBase.ts";
import { z } from "zod";
import store from "../store/index.ts";

export const sshExecuteValidator = z.object({
  command: z.string().trim().min(1),
}).strict();

export type SshExecute = z.infer<typeof sshExecuteValidator>;

export default class Ssh {
  public readonly client = new NodeSSH();
  private readonly connection = {
    isConnected: false,
    revision: 0,
  };

  public get state() {
    const { host, port, username, password } = store.getState().ssh;
    return { host, port, username, password };
  }

  public get revision(): number {
    return this.connection.revision;
  }

  public async isRunning(): Promise<void> {
    if (this.connection.isConnected) {
      try {
        const execution = await this.client.execCommand("true");
        if (execution.code === 0) return;
      } catch {
        this.client.dispose();
      }
      this.connection.isConnected = false;
    }
    await this.client.connect(this.state);
    const execution = await this.client.execCommand("true");
    if (execution.code !== 0) {
      this.client.dispose();
      throw new Error(
        `SSH 连接验证失败 (${String(execution.code)}): ${execution.stderr || execution.stdout}`,
      );
    }
    this.connection.isConnected = true;
    this.connection.revision += 1;
  }

  public async execute(command: SshExecute["command"]): Promise<SSHExecCommandResponse> {
    const input = sshExecuteValidator.parse({ command });
    await this.isRunning();
    const execution = await this.client.execCommand(input.command);
    if (execution.code !== 0) {
      throw new Error(
        `远程命令失败 (${String(execution.code)})\n${execution.stderr || execution.stdout}`,
      );
    }
    return execution;
  }

  public dispose(): void {
    this.client.dispose();
    this.connection.isConnected = false;
    this.connection.revision += 1;
  }
}

export const ssh = new Ssh();

export const sshSlice = mcpserver.metas("ssh")
  .tool(
    "post",
    "/config",
    emptyValidator,
    "读取 SSH 配置，仅返回主机、端口与用户名，绝不返回密码。",
    read,
    (context: McpJsonContext<{}>) => {
      const { host, port, username } = ssh.state;
      return context.json({ host, port, username });
    },
  )
  .tool(
    "post",
    "/state",
    emptyValidator,
    "读取当前 SSH 运行状态摘要，包含主机、端口、用户名与连接版本号。",
    read,
    (context: McpJsonContext<{}>) => {
      const { host, port, username } = ssh.state;
      return context.json({ host, port, username, revision: ssh.revision });
    },
  )
  .tool(
    "post",
    "/connect",
    emptyValidator,
    "建立并验证 SSH 连接，随后返回不含密码的连接状态摘要。",
    mutate,
    async (context: McpJsonContext<{}>) => {
      await ssh.isRunning();
      const { host, port, username } = ssh.state;
      return context.json({ host, port, username, revision: ssh.revision });
    },
  )
  .tool(
    "post",
    "/execute",
    sshExecuteValidator,
    "通过已经建立的 SSH 连接执行指定命令并返回执行结果。",
    mutate,
    async (context: McpJsonContext<SshExecute>) => context.json(
      await ssh.execute(context.req.valid("json").command),
    ),
  )
  .tool(
    "post",
    "/dispose",
    emptyValidator,
    "关闭并释放当前 SSH 连接。",
    mutate,
    (context: McpJsonContext<{}>) => {
      ssh.dispose();
      return context.json({ disposed: true });
    },
  );
