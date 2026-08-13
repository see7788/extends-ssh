import forwardLocStore from "./ForwardLoc/store.ts";
import forwardRemoteStore from "./ForwardRemote/store.ts";
import stunServerStore from "./StunServer/store.ts";
import viteStore from "./Vite/store.ts";
import webrtcProxyStore from "./WebrtcProxy/store.ts";
import cwdPersist from "extends-zustand/cwdPersist";
import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";
import { homedir } from "node:os";
import path from "node:path";
import { createStore } from "zustand";
import type {} from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

type UbuntuStore = {
  ssh: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
  mainDomain: string;
};

type ForwardLocStore = ReturnType<typeof forwardLocStore>;
type ForwardRemoteStore = ReturnType<typeof forwardRemoteStore>;
type StunServerStore = ReturnType<typeof stunServerStore>;
type ViteStore = ReturnType<typeof viteStore>;
type WebrtcProxyStore = ReturnType<typeof webrtcProxyStore>;

type Store = UbuntuStore
  & ForwardLocStore
  & ForwardRemoteStore
  & StunServerStore
  & ViteStore
  & WebrtcProxyStore;

const ubuntuStore: ImmerStateCreator<UbuntuStore> = () => ({
  ssh: {
    host: "82.156.162.242",
    port: 54321,
    username: "root",
    password: "9K78s98[98]j.9",
  },
  mainDomain: "13520521413.store",
});

export default createStore<Store>()(
  cwdPersist({
    cwd: path.join(homedir(), ".extends-ssh"),
    name: "Ubuntu",
    initializer: immer<Store>((set, get, api) => ({
      ...ubuntuStore(set, get, api),
      ...forwardLocStore(set, get, api),
      ...forwardRemoteStore(set, get, api),
      ...stunServerStore(set, get, api),
      ...viteStore(set, get, api),
      ...webrtcProxyStore(set, get, api),
    })),
  }),
);
