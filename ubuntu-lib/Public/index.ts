import store from "../store/index.ts";

export default abstract class {
  private setupPromise?: Promise<void>;

  protected get domain(): string {
    return store.getState().public.domain;
  }

  protected abstract setup(): Promise<void>;

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
