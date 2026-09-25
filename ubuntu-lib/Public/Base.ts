export default abstract class Base<T> {
  private remoteEnsurePromise?: Promise<void>;

  protected abstract remoteIsRunning(): Promise<void>;

  protected ensureRemoteIsRunning(task: () => Promise<void>): Promise<void> {
    if (this.remoteEnsurePromise) return this.remoteEnsurePromise;
    const promise = Promise.resolve().then(task);
    const tracked = promise.finally(() => {
      if (this.remoteEnsurePromise === tracked) this.remoteEnsurePromise = undefined;
    });
    this.remoteEnsurePromise = tracked;
    return tracked;
  }

  abstract readonly current: T;
}
