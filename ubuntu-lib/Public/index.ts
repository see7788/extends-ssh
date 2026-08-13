import store from "../store.ts";

export default class Public {
  public get state() {
    const { domain, remoteRoot } = store.getState().public;
    return { domain, remoteRoot };
  }
}
