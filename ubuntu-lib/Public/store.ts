﻿import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const publicStore: ImmerStateCreator<{
  public: {
    domain: string;
  };
}> = () => ({
  public: {
    domain: "13520521413.store",
  },
});

export default publicStore;
