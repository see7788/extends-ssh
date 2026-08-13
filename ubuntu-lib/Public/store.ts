import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

type PublicStore = {
  public: {
    domain: string;
    remoteRoot: string;
    ssh: {
      host: string;
      port: number;
      username: string;
      password: string;
    };
  };
};

const publicStore: ImmerStateCreator<PublicStore> = () => ({
  public: {
    domain: "13520521413.store",
    remoteRoot: "/www/wwwroot/extends-ssh",
    ssh: {
      host: "82.156.162.242",
      port: 54321,
      username: "root",
      password: "9K78s98[98]j.9",
    },
  },
});

export default publicStore;
