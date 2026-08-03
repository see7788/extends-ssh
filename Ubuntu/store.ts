import viteStore, { type ViteStore } from "extends-ssh/Ubuntu/Vite/store.ts";
import webrtcProxyStore, {
  type WebrtcProxyStore,
} from "extends-ssh/Ubuntu/WebrtcProxy/store.ts";
import cwdPersist from "extends-zustand/cwdPersist";
import { homedir } from "node:os";
import path from "node:path";
import { createStore } from "zustand";
import type {} from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

type Store = ViteStore & WebrtcProxyStore & {
  ssh: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
  mainDomain: string;
};

export default createStore<Store>()(
  cwdPersist({
    cwd: path.join(homedir(), ".extends-ssh"),
    name: "Ubuntu",
    initializer: immer<Store>((set, get, api) => ({
      ssh: {
        host: "82.156.162.242",
        port: 54321,
        username: "root",
        password: "9K78s98[98]j.9",
      },
      mainDomain: "13520521413.store",
      ...viteStore(set, get, api),
      ...webrtcProxyStore(set, get, api),
    })),
  }),
);
