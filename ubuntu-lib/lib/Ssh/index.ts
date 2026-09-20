import { NodeSSH, type SSHExecCommandResponse } from "node-ssh";
import mcpserver from "mcpserver";
import { z } from "zod";
import store from "../store/index.ts";

const sshExecuteValidator = z.object({
  command: z.string().trim().min(1),
}).strict();


import type Base from "../Public/Base.ts";

class Ssh implements Base {
  public readonly client = new NodeSSH();
  private readonly connection = {
    isConnected: false,
    revision: 0,
  };
  private runningPromise?: Promise<void>;

  public get state() {
    const { host, port, username, password } = store.getState().ssh;
    return { host, port, username, password };
  }

  public get revision(): number {
    return this.connection.revision;
  }

  public async remoteIsRunning(): Promise<void> {
    if (this.runningPromise) return this.runningPromise;
    const runningPromise = this.runningEnsure().finally(() => {
      if (this.runningPromise === runningPromise) {
        this.runningPromise = undefined;
      }
    });
    this.runningPromise = runningPromise;
    return runningPromise;
  }

  private async runningEnsure(): Promise<void> {
    if (this.connection.isConnected) {
      try {
        const execution = await this.client.execCommand("true");
        if (execution.code === 0) return;
        this.client.dispose();
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

  public async execute(command: z.infer<typeof sshExecuteValidator>["command"]): Promise<SSHExecCommandResponse> {
    const input = sshExecuteValidator.parse({ command });
    await this.remoteIsRunning();
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

export default mcpserver.metas("/ssh")
  .add({
    protocol: "tool",
    path: "/config",
    description: "读取 SSH 配置，仅返回主机、端口与用户名，绝不返回密码。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: input => {
      const { host, port, username } = ssh.state;
      return { host, port, username };
    },
  })
  .add({
    protocol: "tool",
    path: "/state",
    description: "读取当前 SSH 运行状态摘要，包含主机、端口、用户名与连接版本号。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: input => {
      const { host, port, username } = ssh.state;
      return { host, port, username, revision: ssh.revision };
    },
  })
  .add({
    protocol: "tool",
    path: "/connect",
    description: "建立并验证 SSH 连接，随后返回不含密码的连接状态摘要。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      await ssh.remoteIsRunning();
      const { host, port, username } = ssh.state;
      return { host, port, username, revision: ssh.revision };
    },
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
    path: "/dispose",
    description: "关闭并释放当前 SSH 连接。",
    schema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: input => {
      ssh.dispose();
      return { disposed: true };
    },
  });






