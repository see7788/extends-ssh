import net from "node:net";
import publicRuntime from "../Public/index.ts";

type ForwardRegistration = {
  name: string;
  local: {
    host: string;
    port: number;
  };
  remote: {
    host: string;
    port: number;
  };
};

type ForwardState = ForwardRegistration;

type ForwardRunningState = {
  remotePort: number;
};

type RegisteredForward = {
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

class Forward {
  private readonly forwards = new Map<string, ForwardData>();

  public register(registrationInput: ForwardRegistration): RegisteredForward {
    const registration = this.registrationRead(registrationInput);
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
    await Promise.all([...this.forwards.values()].map(forward => this.forwardClose(forward)));
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
      await publicRuntime.sshIsRunning();
      if (forward.handle && forward.sshRevision === publicRuntime.sshRevision) {
        return { remotePort: forward.handle.port };
      }

      this.connectionsClose(forward);
      await forward.handle?.dispose().catch(() => undefined);
      forward.handle = await publicRuntime.ssh.forwardIn(
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
      forward.sshRevision = publicRuntime.sshRevision;
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
    for (const { local, remote } of forward.connections) {
      local.destroy();
      remote.destroy();
    }
    forward.connections.clear();
  }

  private registrationRead(registration: ForwardRegistration): ForwardRegistration {
    const name = registration.name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
      throw new TypeError(`SSH 转发名称无效: ${registration.name}`);
    }
    return {
      name,
      local: {
        host: this.hostRequired(registration.local.host, "本地目标地址"),
        port: this.portRequired(registration.local.port, "本地目标端口"),
      },
      remote: {
        host: this.hostRequired(registration.remote.host, "远端监听地址"),
        port: this.portRequired(registration.remote.port, "远端监听端口", true),
      },
    };
  }

  private registrationSame(left: ForwardRegistration, right: ForwardRegistration): boolean {
    return left.name === right.name
      && left.local.host === right.local.host
      && left.local.port === right.local.port
      && left.remote.host === right.remote.host
      && left.remote.port === right.remote.port;
  }

  private hostRequired(host: string, label: string): string {
    const value = host.trim();
    if (!value) throw new TypeError(`${label}不能为空`);
    return value;
  }

  private portRequired(port: number, label: string, zeroAllowed = false): number {
    if (!Number.isInteger(port) || port < (zeroAllowed ? 0 : 1) || port > 65_535) {
      throw new TypeError(`${label}必须是${zeroAllowed ? "0-65535" : "1-65535"}的整数`);
    }
    return port;
  }
}

export default new Forward();
