import type peerjsStore from "../Peerjs/store.ts";
import type publicStore from "../Public/store.ts";
import type sftpStore from "../Sftp/store.ts";
import type sshStore from "../Ssh/store.ts";
import type stunServerStore from "../StunServer/store.ts";
import type webrtcsignalingStore from "../Webrtcsignaling/store.ts";

export type Store = ReturnType<typeof peerjsStore>
  & ReturnType<typeof publicStore>
  & ReturnType<typeof sftpStore>
  & ReturnType<typeof sshStore>
  & ReturnType<typeof stunServerStore>
  & ReturnType<typeof webrtcsignalingStore>;
