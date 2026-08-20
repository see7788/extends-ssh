import peerjsStore from "./Peerjs/store.ts";
import publicStore from "./Public/store.ts";
import sshStore from "./Ssh/store.ts";
import stunServerStore from "./StunServer/store.ts";
import webrtcsignalingStore from "./Webrtcsignaling/store.ts";
import cwdPersist from "zustand-lib/cwdPersist";
import { homedir } from "node:os";
import path from "node:path";
import pkg from "./package.json"
import { createStore } from "zustand/vanilla";
import type { } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

type Store = ReturnType<typeof peerjsStore>
  & ReturnType<typeof publicStore>
  & ReturnType<typeof sshStore>
  & ReturnType<typeof stunServerStore>
  & ReturnType<typeof webrtcsignalingStore>;


const store = createStore<Store>()(
  cwdPersist({
    cwd: path.join(homedir(), ".extends-ssh"),
    name: pkg.name,
    initializer: immer<Store>((set, get, api) => ({
      ...publicStore(set, get, api),
      ...sshStore(set, get, api),
      ...peerjsStore(set, get, api),
      ...stunServerStore(set, get, api),
      ...webrtcsignalingStore(set, get, api),
    })),
  }),
);
export default store;
