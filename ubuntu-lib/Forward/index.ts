import net from "node:net";
import { emptyValidator, mcpRegister, mutate, type McpJsonContext } from "../mcpBase.ts";
import { ssh } from "../Ssh/index.ts";
import { z } from "zod";

const hostValidator = z.string().trim().min(1);
export const registerValidator = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  local: z.object({
    host: hostValidator,
    port: z.number().int().min(1).max(65_535),
  }).strict(),
  remote: z.object({
    host: hostValidator,
    port: z.number().int().min(0).max(65_535),
  }).strict(),
}).strict();

export type ForwardRegistration = z.infer<typeof registerValidator>;

export type ForwardState = ForwardRegistration;

export type ForwardRunningState = {
  remotePort: number;
};

export type RegisteredForward = {
  readonly state: ForwardState;
  isRunning(): Promise<ForwardRunningState>;
  close(): Promise<void>;
};

type SshForward = {
  port: number;
  dispose(): Promise<void>;
};

type Connection = {
  local: net.Socket;
  remote: { destroy(): void };
};

type ForwardData = {
  state: ForwardState;
  connections: Set<Connection>;
  instance: RegisteredForward;
  handle?: SshForward;
  running?: Promise<ForwardRunningState>;
  sshRevision?: number;
};

export default class Forward {
  protected readonly ssh = ssh;
  private readonly forwards = new Map<string, ForwardData>();

  public register(registrationInput: ForwardRegistration): RegisteredForward {
    const registration = registerValidator.parse(registrationInput);
    const current = this.forwards.get(registration.name);
    if (current) {
      if (!this.registrationSame(current.state, registration)) {
        throw new Error(`SSH 转发名称已由其他端点占用: ${registration.name}`);
      }
      return current.instance;
    }

    const state = registration;
    let forward: ForwardData;
    const instance: RegisteredForward = {
      get state() {
        return {
          ...state,
          local: { ...state.local },
          remote: { ...state.remote },
        };
      },
      isRunning: () => this.forwardIsRunning(forward),
      close: () => this.forwardClose(forward),
    };
    forward = {
      state,
      connections: new Set(),
      instance,
    };
    this.forwards.set(registration.name, forward);
    return forward.instance;
  }

  public async dispose(): Promise<void> {
    await Promise.all(Array.from(this.forwards.values(), forward => this.forwardClose(forward)));
    this.forwards.clear();
  }

  private forwardIsRunning(forward: ForwardData): Promise<ForwardRunningState> {
    if (forward.running) return forward.running;
    const running = this.forwardRunningEnsure(forward).finally(() => {
      if (forward.running === running) forward.running = undefined;
    });
    forward.running = running;
    return running;
  }

  private async forwardRunningEnsure(forward: ForwardData): Promise<ForwardRunningState> {
    try {
      await this.ssh.isRunning();
      if (forward.handle && forward.sshRevision === this.ssh.revision) {
        return { remotePort: forward.handle.port };
      }

      this.connectionsClose(forward);
      await forward.handle?.dispose().catch(() => undefined);
      forward.handle = await this.ssh.client.forwardIn(
        forward.state.remote.host,
        forward.state.remote.port,
        (_details, accept, reject) => {
          const local = net.createConnection(forward.state.local);
          const failed = () => {
            local.destroy();
            reject();
          };
          local.once("error", failed);
          local.once("connect", () => {
            local.off("error", failed);
            const remote = accept();
            const connection = { local, remote };
            forward.connections.add(connection);
            const close = () => {
              forward.connections.delete(connection);
              local.destroy();
              remote.destroy();
            };
            local.once("close", close);
            remote.once("close", close);
            local.on("error", close);
            remote.on("error", close);
            remote.pipe(local).pipe(remote);
          });
        },
      );
      forward.sshRevision = this.ssh.revision;
      return { remotePort: forward.handle.port };
    } catch (error) {
      forward.handle = undefined;
      forward.sshRevision = undefined;
      throw error;
    }
  }

  private async forwardClose(forward: ForwardData): Promise<void> {
    await forward.running?.catch(() => undefined);
    this.connectionsClose(forward);
    const handle = forward.handle;
    forward.handle = undefined;
    forward.sshRevision = undefined;
    if (handle) await handle.dispose().catch(() => undefined);
  }

  private connectionsClose(forward: ForwardData): void {
    forward.connections.forEach(({ local, remote }) => {
      local.destroy();
      remote.destroy();
    });
    forward.connections.clear();
  }

  private registrationSame(left: ForwardRegistration, right: ForwardRegistration): boolean {
    return left.name === right.name
      && left.local.host === right.local.host
      && left.local.port === right.local.port
      && left.remote.host === right.remote.host
      && left.remote.port === right.remote.port;
  }

}

export const forward = new Forward();

export const forwardSlice = mcpRegister.slice("forward")
  .tool(
    "post",
    "/register",
    registerValidator,
    "注册并返回持久的 SSH 转发状态。",
    mutate,
    async (context: McpJsonContext<ForwardRegistration>) => {
      const registration = forward.register(context.req.valid("json"));
      const running = await registration.isRunning();
      return context.json({ state: registration.state, ...running });
    },
  )
  .tool(
    "post",
    "/dispose",
    emptyValidator,
    "关闭并释放所有持久的 SSH 转发。",
    mutate,
    async (context: McpJsonContext<{}>) => {
      await forward.dispose();
      return context.json({ disposed: true });
    },
  );
