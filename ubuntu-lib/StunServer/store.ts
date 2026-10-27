import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const stunServerStore: ImmerStateCreator<{
  stunServer: {
    port: number;
    containerName: string;
    image: string;
    restartPolicy: string;
    mode: "stun-only";
  };
}> = () => ({
  stunServer: {
    port: 3478,
    containerName: "coturn",
    image: "coturn/coturn:latest",
    restartPolicy: "unless-stopped",
    mode: "stun-only",
  },
});

export default stunServerStore;
