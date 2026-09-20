import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
const publicStore: ImmerStateCreator<{
  domain: string
  port:Record<number,any>
}> = () => ({
  domain: "13520521413.store",
  port:{}
});

export default publicStore;
