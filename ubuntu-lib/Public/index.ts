import store from "../store.ts";

const setupTasks = new WeakMap<object, Promise<void>>();

export default abstract class {

  protected get domain(): string {
    return store.getState().public.domain;
  }

  // 内部健康钩子，仅由 setupReady 调用。
  protected abstract setup(): Promise<void>;
  // 内外部统一通过 setupReady 确保切片可用。全新服务器也确保服务正常运行
  setupReady(): Promise<void> {
    let task = setupTasks.get(this);
    if (!task) {
      task = Promise.resolve().then(() => this.setup()).catch(error => {
        setupTasks.delete(this);
        throw error;
      });
      setupTasks.set(this, task);
    }
    return task;
  }
}
