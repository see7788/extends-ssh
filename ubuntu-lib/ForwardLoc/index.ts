import net from "node:net";
import Public from "../public.ts";
import store from "../store.ts";
import type forwardLocStore from "./store.ts";

type ForwardLocStore = ReturnType<typeof forwardLocStore>;
type ForwardLocRegistration = Parameters<
  ForwardLocStore["forwardLocActions"]["register"]
>[0];
type ForwardLocState = ForwardLocStore["forwardLocs"][string];

type Forward = {
  port: number;
  dispose(): Promise<void>;
};

type Connection = {
  local: net.Socket;
  remote: { destroy(): void };
};

const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const hostRequired = (host: string, label: string): string => {
  const value = host.trim();
  if (!value) throw new TypeError(`${label}不能为空`);
  return value;
};

const portRequired = (port: number, label: string, zeroAllowed = false): number => {
  if (!Number.isInteger(port) || port < (zeroAllowed ? 0 : 1) || port > 65_535) {
    throw new TypeError(`${label}必须是${zeroAllowed ? "0-65535" : "1-65535"}的整数`);
  }
  return port;
};

const registrationRead = (
  registration: ForwardLocRegistration,
): ForwardLocRegistration => {
  const name = registration.name.trim();
  if (!namePattern.test(name)) throw new TypeError(`本地服务转发名称无效: ${registration.name}`);
  return {
    name,
    local: {
      host: hostRequired(registration.local.host, "本地目标地址"),
      port: portRequired(registration.local.port, "本地目标端口"),
    },
    remote: {
      host: hostRequired(registration.remote.host, "远端监听地址"),
      port: portRequired(registration.remote.port, "远端监听端口", true),
    },
  };
};

const registrationSame = (
  left: ForwardLocRegistration,
  right: ForwardLocRegistration,
): boolean => left.name === right.name
  && left.local.host === right.local.host
  && left.local.port === right.local.port
  && left.remote.host === right.remote.host
  && left.remote.port === right.remote.port;

type LocForward = {
  readonly registration: ForwardLocRegistration;
  readonly state: ForwardLocState;
  isRunning(): Promise<ForwardLocState>;
  close(): Promise<ForwardLocState>;
};

class LocForwardRuntime implements LocForward {
  private readonly definition: ForwardLocRegistration;
  private forward?: Forward;
  private running?: Promise<ForwardLocState>;
  private sessionRevision?: number;
  private readonly connections = new Set<Connection>();

  constructor(
    registration: ForwardLocRegistration,
    private readonly runtime: Public,
    private readonly acquire: (name: string) => void,
    private readonly release: (name: string) => void,
  ) {
    this.definition = {
      ...registration,
      local: { ...registration.local },
      remote: { ...registration.remote },
    };
  }

  public get registration(): ForwardLocRegistration {
    return {
      name: this.definition.name,
      local: { ...this.definition.local },
      remote: { ...this.definition.remote },
    };
  }

  public get state(): ForwardLocState {
    const state = store.getState().forwardLocs[this.definition.name];
    if (!state) throw new Error(`本地服务转发尚未注册: ${this.definition.name}`);
    return {
      ...state,
      local: { ...state.local },
      remote: { ...state.remote },
    };
  }

  public isRunning(): Promise<ForwardLocState> {
    if (this.running) return this.running;
    this.running = this.runningEnsure().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  public async close(): Promise<ForwardLocState> {
    await this.running?.catch(() => undefined);
    this.connectionsClose();
    const forward = this.forward;
    this.forward = undefined;
    this.sessionRevision = undefined;
    if (forward) await forward.dispose().catch(() => undefined);
    this.release(this.definition.name);
    store.getState().forwardLocActions.closedSet(this.definition.name);
    return this.state;
  }

  private async runningEnsure(): Promise<ForwardLocState> {
    this.acquire(this.definition.name);
    try {
      await this.runtime.sshIsRunning();
      if (this.forward && this.sessionRevision === this.runtime.sshRevision) {
        store.getState().forwardLocActions.runningSet(
          this.definition.name,
          this.forward.port,
        );
        return this.state;
      }
      this.connectionsClose();
      if (this.forward) await this.forward.dispose().catch(() => undefined);
      const registration = this.registration;
      const forward = await this.runtime.ssh.forwardIn(
        registration.remote.host,
        registration.remote.port,
        (_details, accept, reject) => {
          const local = net.createConnection(registration.local);
          const failed = () => {
            local.destroy();
            reject();
          };
          local.once("error", failed);
          local.once("connect", () => {
            local.off("error", failed);
            const remote = accept();
            const connection = { local, remote };
            this.connections.add(connection);
            const close = () => {
              this.connections.delete(connection);
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
      this.forward = forward;
      this.sessionRevision = this.runtime.sshRevision;
      store.getState().forwardLocActions.runningSet(this.definition.name, forward.port);
      return this.state;
    } catch (error) {
      this.forward = undefined;
      this.sessionRevision = undefined;
      this.release(this.definition.name);
      store.getState().forwardLocActions.failureSet(
        this.definition.name,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private connectionsClose(): void {
    for (const { local, remote } of this.connections) {
      local.destroy();
      remote.destroy();
    }
    this.connections.clear();
  }
}

export default class ForwardLoc {
  private readonly forwards = new Map<string, LocForwardRuntime>();
  private readonly uses = new Set<string>();
  private readonly runtime = new Public();

  public register(registrationInput: ForwardLocRegistration): LocForward {
    const registration = registrationRead(registrationInput);
    const current = this.forwards.get(registration.name);
    if (current) {
      if (!registrationSame(current.registration, registration)) {
        throw new Error(`本地服务转发名称已由其他端点占用: ${registration.name}`);
      }
      return current;
    }
    const forward = new LocForwardRuntime(
      registration,
      this.runtime,
      name => this.uses.add(name),
      name => this.release(name),
    );
    store.getState().forwardLocActions.register(registration);
    this.forwards.set(registration.name, forward);
    return forward;
  }

  public get(name: string): LocForward {
    const forward = this.forwards.get(name);
    if (!forward) throw new Error(`本地服务转发尚未注册: ${name}`);
    return forward;
  }

  public async dispose(): Promise<void> {
    await Promise.all([...this.forwards.values()].map(forward => forward.close()));
    this.runtime.dispose();
  }

  private release(name: string): void {
    this.uses.delete(name);
    if (this.uses.size === 0) this.runtime.dispose();
  }
}
