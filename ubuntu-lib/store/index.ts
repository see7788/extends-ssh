// 服务器环境：Ubuntu 22.04。
// 云服务商：腾讯云。
// 宝塔面板：https://82.156.162.242:22947/d9450c6f
// 宝塔用户名：hazwa0sx
// 宝塔密码：9K78s98[98]j.9
import { homedir } from "node:os";
import path from "node:path";
import cwdPersist from "zustand-lib/cwdPersist";
import { createStore } from "zustand/vanilla";
import type {} from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import peerjsStore from "../Peerjs/store.ts";
import publicStore from "../Public/store.ts";
import sftpStore from "../Sftp/store.ts";
import sshStore from "../Ssh/store.ts";
import stunServerStore from "../StunServer/store.ts";
import webrtcsignalingStore from "../Webrtcsignaling/store.ts";
import pkg from "../package.json";
import type { Store } from "./type.ts";

const store = createStore<Store>()(
  cwdPersist({
    cwd: path.join(homedir(), ".extends-ssh"),
    name: pkg.name,
    initializer: immer<Store>((...s) => ({
      ...publicStore(...s),
      ...sftpStore(...s),
      ...sshStore(...s),
      ...peerjsStore(...s),
      ...stunServerStore(...s),
      ...webrtcsignalingStore(...s),
    })),
  }),
);

export default store;
