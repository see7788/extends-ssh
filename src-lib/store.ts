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
import cwdPersist from "extends-zustand/cwdPersist";
import { homedir } from "node:os";
import path from "node:path";
import { createStore } from "zustand";
import type {} from "zustand/middleware";
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

const store = createStore<Store>()(
  cwdPersist<Store, [], [["zustand/immer", never]]>({
    cwd: path.join(homedir(), ".extends-ssh"),
    initializer: immer((set, get, api) => ({
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
    name: "src-lib",
  }),
);

export default store;
