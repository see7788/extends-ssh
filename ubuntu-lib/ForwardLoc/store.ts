import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

type ForwardLocRegistration = {
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

type ForwardLocState = ForwardLocRegistration & {
  status: "closed" | "running" | "unknown";
  remotePort?: number;
  updatedAt?: string;
  error?: string;
};

type ForwardLocStore = {
  forwardLocs: Record<string, ForwardLocState>;
  forwardLocActions: {
    register(registration: ForwardLocRegistration): void;
    runningSet(name: string, remotePort: number): void;
    closedSet(name: string): void;
    failureSet(name: string, error: string): void;
  };
};

const registrationSame = (
  current: ForwardLocState,
  registration: ForwardLocRegistration,
): boolean => current.name === registration.name
  && current.local.host === registration.local.host
  && current.local.port === registration.local.port
  && current.remote.host === registration.remote.host
  && current.remote.port === registration.remote.port;

const forwardLocStore: ImmerStateCreator<ForwardLocStore> = set => ({
  forwardLocs: {},
  forwardLocActions: {
    register(registration) {
      set(state => {
        const current = state.forwardLocs[registration.name];
        if (current && !registrationSame(current, registration)) {
          throw new Error(`本地服务转发名称已由其他端点占用: ${registration.name}`);
        }
        state.forwardLocs[registration.name] = {
          ...registration,
          local: { ...registration.local },
          remote: { ...registration.remote },
          status: "closed",
        };
      });
    },
    runningSet(name, remotePort) {
      set(state => {
        const forward = state.forwardLocs[name];
        if (!forward) throw new Error(`本地服务转发尚未注册: ${name}`);
        forward.remotePort = remotePort;
        forward.status = "running";
        forward.updatedAt = new Date().toISOString();
        forward.error = undefined;
      });
    },
    closedSet(name) {
      set(state => {
        const forward = state.forwardLocs[name];
        if (!forward) throw new Error(`本地服务转发尚未注册: ${name}`);
        forward.remotePort = undefined;
        forward.status = "closed";
        forward.updatedAt = undefined;
        forward.error = undefined;
      });
    },
    failureSet(name, error) {
      set(state => {
        const forward = state.forwardLocs[name];
        if (!forward) throw new Error(`本地服务转发尚未注册: ${name}`);
        forward.remotePort = undefined;
        forward.status = "unknown";
        forward.updatedAt = undefined;
        forward.error = error;
      });
    },
  },
});

export default forwardLocStore;
