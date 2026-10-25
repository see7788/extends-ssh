import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

type PortOwner = Readonly<{
  key: string;
}>;

interface store_t {
  domain: string;
  prots: Record<number, PortOwner>;
}

const publicStore: ImmerStateCreator<store_t> = () => ({
  domain: "13520521413.store",
  prots: {},
});

export default publicStore;
