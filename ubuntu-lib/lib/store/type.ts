import type peerjsStore from "../peerjs/store.ts";
import type certificateStore from "../certificate/store.ts";
import type publicStore from "../public/store.ts";
import type sftpStore from "../sftp/store.ts";
import type sshStore from "../ssh/store.ts";
import type stunServerStore from "../stunServer/store.ts";
import type localShellStore from "../localShell/store.ts";

export type Store = ReturnType<typeof publicStore>
  & ReturnType<typeof certificateStore>
  & ReturnType<typeof peerjsStore>
  & ReturnType<typeof sftpStore>
  & ReturnType<typeof sshStore>
  & ReturnType<typeof stunServerStore>
  & ReturnType<typeof localShellStore>