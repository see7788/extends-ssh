import Base from "../public/index.ts";
import { NodeSSH, type SSHExecCommandResponse } from "node-ssh";
import store from "../store.ts";

export default class Ssh extends Base {
  private static readonly instances = new Set<Ssh>();
  private readonly client = new NodeSSH();
  private connectPromise?: Promise<void>;
  public constructor() {
    super();
    Ssh.instances.add(this);
  }
  get host(): string {
    return store.getState().ssh.host;
  }
  protected async setup(): Promise<void> {
    await this.connectionReady();
  }

  private async connectionReady(): Promise<void> {
    if (this.client.isConnected()) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect(store.getState().ssh).then(() => undefined).finally(() => {
        this.connectPromise = undefined;
      });
    }
    await this.connectPromise;
  }

  async config(): Promise<Readonly<{ host: string; port: number; username: string }>> {
    const { host, port, username } = store.getState().ssh;
    return { host, port, username };
  }
  quoteShellArg(value: string): string {
    return "'" + value.replace(/'/g, "'\"'\"'") + "'";
  }

  async execute(command: string): Promise<SSHExecCommandResponse> {
    await this.setupReady();
    const execution = await this.client.execCommand(command);
    if (execution.code !== 0) {
      throw new Error(
        `远程命令失败 (${String(execution.code)})\n${execution.stderr || execution.stdout}`,
      );
    }
    return execution;
  }

  async putDirectory(...options: Parameters<NodeSSH["putDirectory"]>): Promise<Awaited<ReturnType<NodeSSH["putDirectory"]>>> {
    await this.setupReady();
    return this.client.putDirectory(...options);
  }

  async forwardIn(...options: Parameters<NodeSSH["forwardIn"]>): Promise<Awaited<ReturnType<NodeSSH["forwardIn"]>>> {
    await this.setupReady();
    return this.client.forwardIn(...options);
  }

  async hasPort(port: number): Promise<{
    occupied: boolean;
    listeners: Array<{
      protocol: "tcp" | "udp";
      address: string;
      port: number;
      pid?: number;
      process?: string;
      path?: string;
    }>;
  }> {
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
        const listener: {
          protocol: "tcp" | "udp";
          address: string;
          port: number;
          pid?: number;
          process?: string;
          path?: string;
        } = {
          protocol: parts[0] as "tcp" | "udp",
          address: local.slice(0, -(String(port).length + 1)),
          port,
          pid: processMatch ? Number(processMatch[2]) : undefined,
          process: processMatch?.[1],
        };
        return listener;
      })
      .filter((listener): listener is {
        protocol: "tcp" | "udp";
        address: string;
        port: number;
        pid?: number;
        process?: string;
        path?: string;
      } => listener !== undefined);
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
    Ssh.instances.delete(this);
  }

  static disposeAll(): void {
    for (const ssh of [...Ssh.instances]) ssh.dispose();
  }
}
