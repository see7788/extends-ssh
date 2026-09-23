export default abstract class Base<T> {
  protected abstract remoteIsRunning(): Promise<void>;
  abstract readonly current: T;
}
