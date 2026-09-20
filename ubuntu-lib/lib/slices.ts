import mcpserver from "mcpserver";
import aptSlice from "./Apt/index.ts";
import dockerSlice from "./Docker/index.ts";
import sshForwardSlice from "./SshForward/index.ts";
import nginxSlice from "./Nginx/index.ts";
import nodejsSlice from "./Nodejs/index.ts";
import peerjsSlice from "./Peerjs/index.ts";
import pm2Slice from "./Pm2/index.ts";
import sftpSlice from "./Sftp/index.ts";
import sshSlice from "./Ssh/index.ts";
import stunServerSlice from "./StunServer/index.ts";

export default mcpserver.metas("/")
  .baseAdd(aptSlice)
  .baseAdd(dockerSlice)
  .baseAdd(sshForwardSlice)
  .baseAdd(nginxSlice)
  .baseAdd(nodejsSlice)
  .baseAdd(peerjsSlice)
  .baseAdd(pm2Slice)
  .baseAdd(sftpSlice)
  .baseAdd(sshSlice)
  .baseAdd(stunServerSlice)
  .import({ name: "ubuntu-lib", description: "单远程 Ubuntu 服务基础能力。" });





