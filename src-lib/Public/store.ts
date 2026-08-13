import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";

type PublicSlice = {
  public: {
    domain: string;
    remoteRoot: string;
  };
};

const s: immerStateCreator<PublicSlice> = () => ({
  public: {
    domain: "13520521413.store",
    remoteRoot: "/www/wwwroot/extends-ssh",
  },
});

export default s;
