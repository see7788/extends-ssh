import Base from "../public/Base.ts";
import { NodeSSH, type SSHExecCommandResponse } from "node-ssh";
import mcpserver from "mcpserver";
import { z } from "zod";
import store from "../store/index.ts";

const sshExecuteValidator = z.object({
  command: z.string().trim().min(1),
}).strict();
const portValidator = z.object({ port: z.number().int().min(1).max(65_535) }).strict();

type PortListener = {
  protocol: "tcp" | "udp";
  address: string;
  port: number;
  pid?: number;
  process?: string;
  path?: string;
};
type PortState = {
  occupied: boolean;
  listeners: PortListener[];
};
type Current = Pick<NodeSSH, "putDirectory" | "forwardIn">;

class Ssh extends Base<() => Promise<Current>> {
  private readonly client = new NodeSSH();
  readonly current = async (): Promise<Current> => {
    await this.remoteIsRunning();
    return {
      putDirectory: this.client.putDirectory.bind(this.client),
      forwardIn: this.client.forwardIn.bind(this.client),
    };
  };
  protected async remoteIsRunning(): Promise<void> {
    if (!this.client.isConnected()) {
      await this.client.connect(store.getState().ssh);
    }
  }

  async execute(command: z.infer<typeof sshExecuteValidator>["command"]): Promise<SSHExecCommandResponse> {
    await this.remoteIsRunning();
    const execution = await this.client.execCommand(command);
    if (execution.code !== 0) {
      throw new Error(
        `远程命令失败 (${String(execution.code)})\n${execution.stderr || execution.stdout}`,
      );
    }
    return execution;
  }

  async hasPort(port: number): Promise<PortState> {
    const result = await this.execute(`
set +e
ss -H -ltnp | awk \\$4 ~ /(^|:)${port}\\$/ { print "tcp\t" \\$0 }
ss -H -lunp | awk \\$4 ~ /(^|:)${port}\\$/ { print "udp\t" \\$0 }
`);
    const listeners = result.stdout
      .split(/\r?\n/)
      .map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6 || (parts[0] !== "tcp" && parts[0] !== "udp")) return undefined;
        const local = parts[4];
        const processInfo = parts.slice(6).join(" ");
        const processMatch = processInfo.match(/users:\(\("([^"]+)",pid=(\d+)/);
        const listener: PortListener = {
          protocol: parts[0],
          address: local.slice(0, -(String(port).length + 1)),
          port,
          pid: processMatch ? Number(processMatch[2]) : undefined,
          process: processMatch?.[1],
        };
        return listener;
      })
      .filter((listener): listener is PortListener => listener !== undefined);
    await Promise.all(listeners.map(async listener => {
      if (listener.pid === undefined) return;
      const process = await this.execute(`
pid=${listener.pid}
path=$(readlink -f /proc/$pid/cwd 2>/dev/null || true)
command=$(tr "\0" " " < /proc/$pid/cmdline 2>/dev/null || true)
printf "%s\n%s" "$path" "$command"
`);
      const [path, command] = process.stdout.split(/\r?\n/);
      if (path) {
        listener.path = path;
      }
      if (!listener.process && command) listener.process = command.trim();
    }));
    return { occupied: listeners.length > 0, listeners };
  }

  dispose(): void {
    this.client.dispose();
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
      const { host, port, username } = store.getState().ssh;
      return { host, port, username };
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
