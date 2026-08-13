import stunServerStore from "./StunServer/store.ts";
import webrtcsignalingStore from "./Webrtcsignaling/store.ts";
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
  remoteRoot: string;
};

type StunServerStore = ReturnType<typeof stunServerStore>;
type WebrtcsignalingStore = ReturnType<typeof webrtcsignalingStore>;

type Store = UbuntuStore
  & StunServerStore
  & WebrtcsignalingStore;

const ubuntuStore: ImmerStateCreator<UbuntuStore> = () => ({
  ssh: {
    host: "82.156.162.242",
    port: 54321,
    username: "root",
    password: "9K78s98[98]j.9",
  },
  mainDomain: "13520521413.store",
  remoteRoot: "/www/wwwroot/extends-ssh",
});

export default createStore<Store>()(
  cwdPersist({
    cwd: path.join(homedir(), ".extends-ssh"),
    name: "Ubuntu",
    initializer: immer<Store>((set, get, api) => ({
      ...ubuntuStore(set, get, api),
      ...stunServerStore(set, get, api),
      ...webrtcsignalingStore(set, get, api),
    })),
  }),
);
