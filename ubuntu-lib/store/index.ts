import { homedir } from "node:os";
import path from "node:path";
import cwdPersist from "zustand-lib/cwdPersist";
import { createStore } from "zustand/vanilla";
import { immer } from "zustand/middleware/immer";
import peerjsStore from "../Peerjs/store.ts";
import publicStore from "../Public/store.ts";
import sshStore from "../Ssh/store.ts";
import stunServerStore from "../StunServer/store.ts";
import webrtcsignalingStore from "../Webrtcsignaling/store.ts";
import pkg from "../package.json";
import type { Store } from "./type.ts";

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
