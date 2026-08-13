import Public from "../Public/index.ts";

export default class Pm2 {
  private remoteRunningPromise?: Promise<void>;

  public isRemoteRunning(): Promise<void> {
    if (this.remoteRunningPromise) return this.remoteRunningPromise;
    const runtime = new Public();
    const remoteRunningPromise = runtime.pm2IsRunning().finally(() => {
      runtime.dispose();
      if (this.remoteRunningPromise === remoteRunningPromise) {
        this.remoteRunningPromise = undefined;
      }
    });
    this.remoteRunningPromise = remoteRunningPromise;
    return remoteRunningPromise;
  }
}
