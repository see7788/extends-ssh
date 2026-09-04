import { isAbsolute, resolve } from "node:path";

export type PublicRegistration = {
  path: string;
  port: number;
  version: string;
};

/**
 * Version-aware single-flight base for projects registered by a Vite plugin.
 *
 * The Vite plugin supplies the absolute project path, port, and package
 * version through the store. A concrete service only needs to expose the
 * current registration and implement one reconciliation pass.
 */
export default abstract class Base {
  private remoteRunningPromise?: Promise<void>;

  protected abstract get registration(): PublicRegistration | undefined;

  protected abstract remoteRunningEnsure(registration: PublicRegistration): Promise<void>;

  public isRemoteRunning(): Promise<void> {
    if (this.remoteRunningPromise) return this.remoteRunningPromise;
    const remoteRunningPromise = this.remoteRunningEnsureLoop().finally(() => {
      if (this.remoteRunningPromise === remoteRunningPromise) {
        this.remoteRunningPromise = undefined;
      }
    });
    this.remoteRunningPromise = remoteRunningPromise;
    return remoteRunningPromise;
  }

  private async remoteRunningEnsureLoop(): Promise<void> {
    for (;;) {
      const registration = this.registration;
      if (!registration) throw new Error("项目注册信息不存在");
      this.registrationValidate(registration);

      await this.remoteRunningEnsure(registration);

      const latest = this.registration;
      if (!latest) throw new Error("项目注册信息已被移除");
      this.registrationValidate(latest);
      if (
        latest.port === registration.port
        && resolve(latest.path) === resolve(registration.path)
        && latest.version === registration.version
      ) return;
    }
  }

  private registrationValidate(registration: PublicRegistration): void {
    if (typeof registration.path !== "string" || !isAbsolute(registration.path)) {
      throw new Error(`项目注册路径必须是绝对路径: ${registration.path}`);
    }
    if (!Number.isInteger(registration.port) || registration.port < 1 || registration.port > 65_535) {
      throw new RangeError(`项目端口无效: ${String(registration.port)}`);
    }
    if (typeof registration.version !== "string" || !registration.version.trim()) {
      throw new Error("项目版本不能为空");
    }
  }
}
