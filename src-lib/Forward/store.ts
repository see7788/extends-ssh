import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import net from "node:net";
import type { NodeSSH } from "node-ssh";

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

type ForwardRunningState = {
  remotePort: number;
};

type RegisteredForward = {
  readonly state: ForwardRegistration;
  isRunning(): Promise<ForwardRunningState>;
  close(): Promise<void>;
};

type ForwardSlice = {
  ForwardActions: {
    register(registration: ForwardRegistration): RegisteredForward;
    dispose(): Promise<void>;
  };
};

type SshDependency = {
  SshActions: {
    isRunning(): Promise<void>;
    runtime(): {
      client: NodeSSH;
      revision: number;
    };
  };
};

type ForwardHandle = {
  port: number;
  dispose(): Promise<void>;
};

type Connection = {
  local: net.Socket;
  remote: { destroy(): void };
};

type ForwardData = {
  state: ForwardRegistration;
  connections: Set<Connection>;
  instance: RegisteredForward;
  handle?: ForwardHandle;
  running?: Promise<ForwardRunningState>;
  sshRevision?: number;
};

const s: immerStateCreator<ForwardSlice, SshDependency> = (_set, get) => {
  const forwards = new Map<string, ForwardData>();
  const hostRequired = (host: string, label: string): string => {
    const value = host.trim();
    if (!value) throw new TypeError(`${label}不能为空`);
    return value;
  };
  const portRequired = (
    port: number,
    label: string,
    zeroAllowed = false,
  ): number => {
    if (!Number.isInteger(port) || port < (zeroAllowed ? 0 : 1) || port > 65_535) {
      throw new TypeError(`${label}必须是${zeroAllowed ? "0-65535" : "1-65535"}的整数`);
    }
    return port;
  };
  const connectionsClose = (forward: ForwardData): void => {
    forward.connections.forEach(({ local, remote }) => {
      local.destroy();
      remote.destroy();
    });
    forward.connections.clear();
  };
  const forwardClose = async (forward: ForwardData): Promise<void> => {
    await forward.running?.catch(() => undefined);
    connectionsClose(forward);
    const handle = forward.handle;
    forward.handle = undefined;
    forward.sshRevision = undefined;
    if (handle) await handle.dispose().catch(() => undefined);
  };
  const forwardIsRunning = (forward: ForwardData): Promise<ForwardRunningState> => {
    if (forward.running) return forward.running;
    const running = (async () => {
      try {
        await get().SshActions.isRunning();
        const sshRuntime = get().SshActions.runtime();
        if (forward.handle && forward.sshRevision === sshRuntime.revision) {
          return { remotePort: forward.handle.port };
        }
        connectionsClose(forward);
        await forward.handle?.dispose().catch(() => undefined);
        forward.handle = await sshRuntime.client.forwardIn(
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
        forward.sshRevision = sshRuntime.revision;
        return { remotePort: forward.handle.port };
      } catch (error) {
        forward.handle = undefined;
        forward.sshRevision = undefined;
        throw error;
      }
    })().finally(() => {
      if (forward.running === running) forward.running = undefined;
    });
    forward.running = running;
    return running;
  };

  return {
    ForwardActions: {
      register(registrationInput) {
        const name = registrationInput.name.trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
          throw new TypeError(`SSH 转发名称无效: ${registrationInput.name}`);
        }
        const state: ForwardRegistration = {
          name,
          local: {
            host: hostRequired(registrationInput.local.host, "本地目标地址"),
            port: portRequired(registrationInput.local.port, "本地目标端口"),
          },
          remote: {
            host: hostRequired(registrationInput.remote.host, "远端监听地址"),
            port: portRequired(registrationInput.remote.port, "远端监听端口", true),
          },
        };
        const current = forwards.get(name);
        if (current) {
          const same = current.state.local.host === state.local.host
            && current.state.local.port === state.local.port
            && current.state.remote.host === state.remote.host
            && current.state.remote.port === state.remote.port;
          if (!same) throw new Error(`SSH 转发名称已由其他端点占用: ${name}`);
          return current.instance;
        }
        let forward: ForwardData;
        const instance: RegisteredForward = {
          get state() {
            return {
              ...state,
              local: { ...state.local },
              remote: { ...state.remote },
            };
          },
          isRunning: () => forwardIsRunning(forward),
          close: () => forwardClose(forward),
        };
        forward = { state, connections: new Set(), instance };
        forwards.set(name, forward);
        return instance;
      },
      async dispose() {
        await Promise.all(Array.from(forwards.values(), forwardClose));
        forwards.clear();
      },
    },
  };
};

export default s;
