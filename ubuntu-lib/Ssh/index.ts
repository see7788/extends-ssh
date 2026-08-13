import { NodeSSH, type SSHExecCommandResponse } from "node-ssh";
import store from "../store.ts";

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
      throw new Error(`SSH 连接验证失败 (${String(execution.code)})`, {
        cause: execution.stderr || execution.stdout,
      });
    }
    this.connection.isConnected = true;
    this.connection.revision += 1;
  }

  public async execute(command: string): Promise<SSHExecCommandResponse> {
    await this.isRunning();
    const execution = await this.client.execCommand(command);
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
