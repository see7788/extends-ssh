import { createStore, type StoreApi } from "zustand/vanilla";
import { immer } from "zustand/middleware/immer";
import ubuntu from "./ubuntu/store";
import ubuntuRemote from "./ubuntuRemote/store";

type Store = ReturnType<typeof ubuntu> & ReturnType<typeof ubuntuRemote>;

export default createStore<Store>()(
  immer((...options) => ({
    ...ubuntu(...options),
    ...ubuntuRemote(...options),
  })),
) satisfies StoreApi<Store>;
