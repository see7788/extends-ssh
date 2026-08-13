import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";

type PublicStore = {
  public: {
    domain: string;
    remoteRoot: string;
  };
};

const publicStore: ImmerStateCreator<PublicStore> = () => ({
  public: {
    domain: "13520521413.store",
    remoteRoot: "/www/wwwroot/extends-ssh",
  },
});

export default publicStore;
