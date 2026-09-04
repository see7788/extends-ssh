import mcpserver from "mcpserver";
import { aptSlice } from "./Apt/index.ts";
import { dockerSlice } from "./Docker/index.ts";
import { forwardSlice } from "./Forward/index.ts";
import { nginxSlice } from "./Nginx/index.ts";
import { nodejsSlice } from "./Nodejs/index.ts";
import { peerjsSlice } from "./Peerjs/index.ts";
import { pm2Slice } from "./Pm2/index.ts";
import { publicSlice } from "./Public/index.ts";
import { sftpSlice } from "./Sftp/index.ts";
import { sshSlice } from "./Ssh/index.ts";
import { stunServerSlice } from "./StunServer/index.ts";
import { viteSlice } from "./Vite/index.ts";
import { webrtcsignalingSlice } from "./Webrtcsignaling/index.ts";

export {
  aptSlice,
  dockerSlice,
  forwardSlice,
  nginxSlice,
  nodejsSlice,
  peerjsSlice,
  pm2Slice,
  publicSlice,
  sftpSlice,
  sshSlice,
  stunServerSlice,
  viteSlice,
  webrtcsignalingSlice,
};

export default mcpserver.room("ubuntu", "配置和交付 Ubuntu 上的系统与应用能力。").register(
  aptSlice,
  dockerSlice,
  forwardSlice,
  nginxSlice,
  nodejsSlice,
  peerjsSlice,
  pm2Slice,
  publicSlice,
  sftpSlice,
  sshSlice,
  stunServerSlice,
  viteSlice,
  webrtcsignalingSlice,
).import();
