import mcpserver from "mcpserver";
import aptSlice from "./apt/mcpserver.ts";
import dockerSlice from "./docker/mcpserver.ts";
import kasmVncKasmSlice from "./kasmVnc/mcpserver.ts";
import certificateSlice from "./certificate/mcpserver.ts";
import sshForwardSlice from "./sshForward/mcpserver.ts";
import nginxSlice from "./nginx/mcpserver.ts";
import nodejsSlice from "./nodejs/mcpserver.ts";
import peerjsSlice from "./peerjs/mcpserver.ts";
import pm2Slice from "./pm2/mcpserver.ts";
import sftpSlice from "./sftp/mcpserver.ts";
import sshSlice from "./ssh/mcpserver.ts";
import stunServerSlice from "./stunServer/mcpserver.ts";
import vpnMihomoSlice from "./vpnMihomo/mcpserver.ts";
import viteSlice from "./vite/mcpserver.ts";

export default mcpserver.metas("/")
  .baseAdd(viteSlice)
  .baseAdd(aptSlice)
  .baseAdd(dockerSlice)
  .baseAdd(kasmVncKasmSlice)
  .baseAdd(certificateSlice)
  .baseAdd(sshForwardSlice)
  .baseAdd(nginxSlice)
  .baseAdd(nodejsSlice)
  .baseAdd(peerjsSlice)
  .baseAdd(pm2Slice)
  .baseAdd(sftpSlice)
  .baseAdd(sshSlice)
  .baseAdd(stunServerSlice)
  .baseAdd(vpnMihomoSlice)
  .import({ name: "ubuntu-lib", description: "单远程 Ubuntu 服务基础能力。" });
