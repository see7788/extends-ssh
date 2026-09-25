import mcpserver from "mcpserver";
import aptSlice from "./apt/index.ts";
import dockerSlice from "./docker/index.ts";
import certificateSlice from "./certificate/index.ts";
import sshForwardSlice from "./sshForward/index.ts";
import nginxSlice from "./nginx/index.ts";
import nodejsSlice from "./nodejs/index.ts";
import peerjsSlice from "./peerjs/index.ts";
import pm2Slice from "./pm2/index.ts";
import sftpSlice from "./sftp/index.ts";
import sshSlice from "./ssh/index.ts";
import stunServerSlice from "./stunServer/index.ts";

export default mcpserver.metas("/")
  .baseAdd(aptSlice)
  .baseAdd(dockerSlice)
  .baseAdd(certificateSlice)
  .baseAdd(sshForwardSlice)
  .baseAdd(nginxSlice)
  .baseAdd(nodejsSlice)
  .baseAdd(peerjsSlice)
  .baseAdd(pm2Slice)
  .baseAdd(sftpSlice)
  .baseAdd(sshSlice)
  .baseAdd(stunServerSlice)
  .import({ name: "ubuntu-lib", description: "单远程 Ubuntu 服务基础能力。" });
