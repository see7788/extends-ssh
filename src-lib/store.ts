import aptStore from "./Apt/store.ts";
import dockerStore from "./Docker/store.ts";
import forwardStore from "./Forward/store.ts";
import nginxStore from "./Nginx/store.ts";
import nodejsStore from "./Nodejs/store.ts";
import peerjsStore from "./Peerjs/store.ts";
import pm2Store from "./Pm2/store.ts";
import publicStore from "./Public/store.ts";
import sftpStore from "./Sftp/store.ts";
import sshStore from "./Ssh/store.ts";
import stunServerStore from "./StunServer/store.ts";
import viteStore from "./Vite/store.ts";
import webrtcsignalingStore from "./Webrtcsignaling/store.ts";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createStore } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

type Store = ReturnType<typeof publicStore>
  & ReturnType<typeof sshStore>
  & ReturnType<typeof aptStore>
  & ReturnType<typeof nodejsStore>
  & ReturnType<typeof dockerStore>
  & ReturnType<typeof sftpStore>
  & ReturnType<typeof pm2Store>
  & ReturnType<typeof forwardStore>
  & ReturnType<typeof nginxStore>
  & ReturnType<typeof peerjsStore>
  & ReturnType<typeof stunServerStore>
  & ReturnType<typeof webrtcsignalingStore>
  & ReturnType<typeof viteStore>;

type PersistedState = Pick<
  Store,
  "public" | "ssh" | "nodejs" | "nginx" | "peerjs" | "stunServer" | "webrtcsignaling"
>;

const persistPath = path.join(
  homedir(),
  ".extends-ssh",
  ".zustand",
  "src-lib.json",
);
const storage: StateStorage = {
  getItem: () => existsSync(persistPath)
    ? readFileSync(persistPath, "utf8")
    : null,
  setItem: (_name, value) => {
    mkdirSync(path.dirname(persistPath), { recursive: true });
    writeFileSync(persistPath, value, "utf8");
  },
  removeItem: () => {
    if (existsSync(persistPath)) rmSync(persistPath);
  },
};

const store = createStore<Store>()(
  persist<Store, [], [["zustand/immer", never]], PersistedState>(
    immer((set, get, api) => ({
      ...publicStore(set, get, api),
      ...sshStore(set, get, api),
      ...aptStore(set, get, api),
      ...nodejsStore(set, get, api),
      ...dockerStore(set, get, api),
      ...sftpStore(set, get, api),
      ...pm2Store(set, get, api),
      ...forwardStore(set, get, api),
      ...nginxStore(set, get, api),
      ...peerjsStore(set, get, api),
      ...stunServerStore(set, get, api),
      ...webrtcsignalingStore(set, get, api),
      ...viteStore(set, get, api),
    })),
    {
      name: "src-lib",
      storage: createJSONStorage<PersistedState>(() => storage),
      partialize: state => ({
        public: { ...state.public },
        ssh: { ...state.ssh },
        nodejs: { ...state.nodejs },
        nginx: { ...state.nginx },
        peerjs: { ...state.peerjs },
        stunServer: { ...state.stunServer },
        webrtcsignaling: { ...state.webrtcsignaling },
      }),
    },
  ),
);

export default store;
