import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const sshStore: ImmerStateCreator<{
  ssh: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
}> = () => ({
  ssh: {
    host: process.env.EXTENDS_SSH_HOST ?? "127.0.0.1",
    port: Number(process.env.EXTENDS_SSH_PORT ?? 22),
    username: process.env.EXTENDS_SSH_USERNAME ?? "root",
    password: process.env.EXTENDS_SSH_PASSWORD ?? "change-me",
  },
});

export default sshStore;





