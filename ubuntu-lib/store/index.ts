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
