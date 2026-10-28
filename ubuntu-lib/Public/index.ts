import store from "../store.ts";

export default abstract class {
  private setupPromise?: Promise<void>;

  protected get domain(): string {
    return store.getState().public.domain;
  }

  // 内部健康钩子，仅由 setupReady 调用。
  protected abstract setup(): Promise<void>;
  // 内外部统一通过 setupReady 确保切片可用。全新服务器也确保服务正常运行
  setupReady(): Promise<void> {
    if (!this.setupPromise) {
      const promise = this.setup().catch(error => {
        if (this.setupPromise === promise) this.setupPromise = undefined;
        throw error;
      });
      this.setupPromise = promise;
    }
    return this.setupPromise;
  }
}
