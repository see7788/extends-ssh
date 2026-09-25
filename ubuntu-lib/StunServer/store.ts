import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const stunServerStore: ImmerStateCreator<{
  stunServer: { port: number };
}> = () => ({
  stunServer: { port: 3478 },
});

export default stunServerStore;
