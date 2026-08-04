import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

export type SshServiceRegistration = {
  name: string;
  localPath: string;
  remotePath: string;
  processName: string;
  entry: string;
  environment: Record<string, string>;
  healthCommand: string;
};

export type SshServiceState = SshServiceRegistration & {
  status: "unknown" | "running";
  revision?: string;
  updatedAt?: string;
  error?: string;
};

export type SshServiceStore = {
  sshServices: Record<string, SshServiceState>;
  sshServicesActions: {
    register(registration: SshServiceRegistration): void;
    targetSet(name: string, revision: string): void;
    runningSet(name: string): void;
    failureSet(name: string, error: string): void;
  };
};

const definitionSame = (
  current: SshServiceState,
  registration: SshServiceRegistration,
): boolean => current.localPath === registration.localPath
  && current.remotePath === registration.remotePath
  && current.processName === registration.processName
  && current.entry === registration.entry
  && current.healthCommand === registration.healthCommand
  && JSON.stringify(current.environment) === JSON.stringify(
    registration.environment,
  );

const store = <T extends object = {}>(
  ...options: Parameters<ImmerStateCreator<SshServiceStore, T>>
): SshServiceStore => {
  const [set] = options;
  return {
    sshServices: {},
    sshServicesActions: {
      register(registration) {
        set(state => {
          const current = state.sshServices[registration.name];
          if (current && definitionSame(current, registration)) return;
          if (current) {
            throw new Error(
              `SSH 服务名称已由其他定义占用: ${registration.name}`,
            );
          }
          state.sshServices[registration.name] = {
            ...registration,
            status: "unknown",
          };
        });
      },
      targetSet(name, revision) {
        set(state => {
          const service = state.sshServices[name];
          if (!service) throw new Error(`SSH 服务尚未注册: ${name}`);
          if (service.revision !== revision) {
            service.status = "unknown";
            service.updatedAt = undefined;
          }
          service.revision = revision;
          service.error = undefined;
        });
      },
      runningSet(name) {
        set(state => {
          const service = state.sshServices[name];
          if (!service) throw new Error(`SSH 服务尚未注册: ${name}`);
          service.status = "running";
          service.updatedAt = new Date().toISOString();
          service.error = undefined;
        });
      },
      failureSet(name, error) {
        set(state => {
          const service = state.sshServices[name];
          if (!service) throw new Error(`SSH 服务尚未注册: ${name}`);
          service.status = "unknown";
          service.error = error;
        });
      },
    },
  };
};

export default store;
