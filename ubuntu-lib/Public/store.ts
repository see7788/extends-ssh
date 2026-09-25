import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const publicStore: ImmerStateCreator<{ domain: string }> = () => ({
  domain: "13520521413.store",
});

export default publicStore;
