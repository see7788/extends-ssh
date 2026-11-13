import path from "node:path";
import cwdPersist from "zustand-lib/cwdPersist";
import { createStore } from "zustand/vanilla";
import type {} from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import peerjsStore from "./peerjs/store.ts";
import publicStore from "./public/store.ts";
import sshStore from "./ssh/store.ts";
import stunServerStore from "./stunServer/store.ts";
import nodejsStore from "./nodejs/store.ts";
import postsStore from "./ports/store.ts";
import vpnMihomoStore from "./vpnMihomo/store.ts";
import kasmVncStore from "./kasmVnc/store.ts";
import frpStore from "./frp/store.ts";

import pkg from "./package.json" with { type: "json" };

const store = createStore<
ReturnType<typeof publicStore>
  & ReturnType<typeof peerjsStore>
  & ReturnType<typeof sshStore>
  & ReturnType<typeof stunServerStore>
  & ReturnType<typeof nodejsStore>
  & ReturnType<typeof postsStore>
  & ReturnType<typeof vpnMihomoStore>
  & ReturnType<typeof kasmVncStore>
  & ReturnType<typeof frpStore>
>()(
  cwdPersist({
    cwd: path.join(import.meta.dirname, ".store"),
    name: pkg.name,
    initializer: immer((...s) => ({
      ...publicStore(...s),
      ...sshStore(...s),
      ...peerjsStore(...s),
      ...stunServerStore(...s),
      ...nodejsStore(...s),
      ...postsStore(...s),
      ...vpnMihomoStore(...s),
      ...kasmVncStore(...s),
      ...frpStore(...s),
    })),
  }),
);
//库外部严禁消费；项目内切片严禁跨切片消费，各个切片消费自己的store（跨切片消费只能用该切片的index提供的公开参数）
export default store;
