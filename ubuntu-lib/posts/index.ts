import store from "../store/index.ts";

export default class {
  async portUse(port: number, ownerKey: string): Promise<void> {
    const state = store.getState();
    const current = state.posts[port];
    if (current && current !== ownerKey) {
      throw new Error(`Port ${port} is already owned by ${current}`);
    }
    if (!current) {
      store.setState(draft => {
        draft.posts[port] = ownerKey;
      });
    }
  }
}
