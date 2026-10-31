import path from "node:path";
import { fileURLToPath } from "node:url";
import cwdPersist from "zustand-lib/cwdPersist";
import { createStore } from "zustand/vanilla";
import type {} from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import peerjsStore from "./peerjs/store.ts";
import publicStore from "./public/store.ts";
import sftpStore from "./sftp/store.ts";
import sshStore from "./ssh/store.ts";
import stunServerStore from "./stunServer/store.ts";
import nginxStore from "./nginx/store.ts";
import nodejsStore from "./nodejs/store.ts";
import letsencryptStore from "./letsencrypt/store.ts";
import viteStore from "./vite/store.ts";
import postsStore from "./posts/store.ts";
import vpnMihomoStore from "./vpnMihomo/store.ts";
import kasmVncStore from "./kasmVnc/store.ts";
import frpStore from "./frp/store.ts";
import pkg from "./package.json";

const store = createStore<
ReturnType<typeof publicStore>
  & ReturnType<typeof letsencryptStore>
  & ReturnType<typeof peerjsStore>
  & ReturnType<typeof sftpStore>
  & ReturnType<typeof sshStore>
  & ReturnType<typeof stunServerStore>
  & ReturnType<typeof nginxStore>
  & ReturnType<typeof nodejsStore>
  & ReturnType<typeof viteStore>
  & ReturnType<typeof postsStore>
  & ReturnType<typeof vpnMihomoStore>
  & ReturnType<typeof kasmVncStore>
  & ReturnType<typeof frpStore>
>()(
  cwdPersist({
    cwd: path.join(path.dirname(fileURLToPath(new URL("./package.json", import.meta.url))), ".extends-ssh"),
    name: pkg.name,
    initializer: immer((...s) => ({
      ...publicStore(...s),
      ...sftpStore(...s),
      ...sshStore(...s),
      ...peerjsStore(...s),
      ...stunServerStore(...s),
      ...nginxStore(...s),
      ...nodejsStore(...s),
      ...letsencryptStore(...s),
      ...viteStore(...s),
      ...postsStore(...s),
      ...vpnMihomoStore(...s),
      ...kasmVncStore(...s),
      ...frpStore(...s),
    })),
  }),
);

export default store;
