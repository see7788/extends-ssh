import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const postsStore: ImmerStateCreator<{
  posts: Record<number, string>;
}> = () => ({
  posts: {},
});

export default postsStore;
