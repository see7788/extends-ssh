import peerjsStore from "./Peerjs/store.ts";
import publicStore from "./Public/store.ts";
import sshStore from "./Ssh/store.ts";
import stunServerStore from "./StunServer/store.ts";
import webrtcsignalingStore from "./Webrtcsignaling/store.ts";
import cwdPersist from "extends-zustand/cwdPersist";
import { homedir } from "node:os";
import path from "node:path";
import { createStore } from "zustand";
import type {} from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

type PeerjsStore = ReturnType<typeof peerjsStore>;
type PublicStore = ReturnType<typeof publicStore>;
type SshStore = ReturnType<typeof sshStore>;
type StunServerStore = ReturnType<typeof stunServerStore>;
type WebrtcsignalingStore = ReturnType<typeof webrtcsignalingStore>;

type Store = PublicStore
  & SshStore
  & PeerjsStore
  & StunServerStore
  & WebrtcsignalingStore;

type PersistedState = Pick<
  Store,
  "peerjs" | "public" | "ssh" | "stunServer" | "webrtcsignaling"
>;

const store = createStore<Store>()(
  cwdPersist({
    cwd: path.join(homedir(), ".extends-ssh"),
    name: "ubuntu-lib",
    initializer: immer<Store>((set, get, api) => ({
      ...publicStore(set, get, api),
      ...sshStore(set, get, api),
      ...peerjsStore(set, get, api),
      ...stunServerStore(set, get, api),
      ...webrtcsignalingStore(set, get, api),
    })),
  }),
);

const persistedStateRead = (state: Store): PersistedState => ({
  peerjs: structuredClone(state.peerjs),
  public: {
    domain: state.public.domain,
    remoteRoot: state.public.remoteRoot,
  },
  ssh: {
    host: state.ssh.host,
    port: state.ssh.port,
    username: state.ssh.username,
    password: state.ssh.password,
  },
  stunServer: structuredClone(state.stunServer),
  webrtcsignaling: structuredClone(state.webrtcsignaling),
});

store.persist.setOptions({
  partialize: state => persistedStateRead(state) as Store,
});

export default store;
