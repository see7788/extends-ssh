import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

type SshStore = {
  ssh: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
};

const sshStore: ImmerStateCreator<SshStore> = () => ({
  ssh: {
    host: "82.156.162.242",
    port: 54321,
    username: "root",
    password: "9K78s98[98]j.9",
  },
});

export default sshStore;
