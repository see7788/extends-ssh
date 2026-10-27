import type peerjsStore from "../peerjs/store.ts";
import type certificateStore from "../certificate/store.ts";
import type publicStore from "../public/store.ts";
import type sftpStore from "../sftp/store.ts";
import type sshStore from "../ssh/store.ts";
import type stunServerStore from "../stunServer/store.ts";
import type nginxStore from "../nginx/store.ts";
import type nodejsStore from "../nodejs/store.ts";
import type viteStore from "../vite/store.ts"
import type postsStore from "../posts/store.ts";
import type vpnServerStore from "../vpnServer/store.ts";
import type chromiumServerStore from "../chromiumServer/store.ts";
export type Store = ReturnType<typeof publicStore>
  & ReturnType<typeof certificateStore>
  & ReturnType<typeof peerjsStore>
  & ReturnType<typeof sftpStore>
  & ReturnType<typeof sshStore>
  & ReturnType<typeof stunServerStore>
  & ReturnType<typeof nginxStore>
  & ReturnType<typeof nodejsStore>
  & ReturnType<typeof viteStore>
  & ReturnType<typeof postsStore>
  & ReturnType<typeof vpnServerStore>
  & ReturnType<typeof chromiumServerStore>
