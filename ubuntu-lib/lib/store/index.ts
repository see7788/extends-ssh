// 服务器环境：Ubuntu 22.04。
// 云服务商：腾讯云。
// 宝塔面板：https://82.156.162.242:22947/d9450c6f
// 宝塔用户名：hazwa0sx
// 宝塔密码：9K78s98[98]j.9
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cwdPersist from "zustand-lib/cwdPersist";
import { createStore } from "zustand/vanilla";
import type {} from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import peerjsStore from "../peerjs/store.ts";
import publicStore from "../public/store.ts";
import sftpStore from "../sftp/store.ts";
import sshStore from "../ssh/store.ts";
import stunServerStore from "../stunServer/store.ts";
import localShellStore from "../localShell/store.ts";
import nginxStore from "../nginx/store.ts";
import nodejsStore from "../nodejs/store.ts";
import certificateStore from "../certificate/store.ts";
import pkg from "../../package.json";
import type { Store } from "./type.ts";

const packageRoot = path.dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));

const store = createStore<Store>()(
  cwdPersist({
    cwd: path.join(packageRoot, ".extends-ssh"),
    name: pkg.name,
    initializer: immer<Store>((...s) => ({
      ...publicStore(...s),
      ...sftpStore(...s),
      ...sshStore(...s),
      ...peerjsStore(...s),
      ...stunServerStore(...s),
      ...localShellStore(...s),
      ...nginxStore(...s),
      ...nodejsStore(...s),
      ...certificateStore(...s),
    })),
  }),
);
export default store;
