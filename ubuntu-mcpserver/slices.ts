import mcpserver from "mcpserver";
import apt from "./apt/index.ts";
import docker from "./docker/index.ts";
import nginx from "./nginx/index.ts";
import nodejs from "./nodejs/index.ts";
import peerjs from "./peerjs/index.ts";
import pm2 from "./pm2/index.ts";
import publicSlice from "./public/index.ts";
import sftp from "./sftp/index.ts";
import ssh from "./ssh/index.ts";
import stunServer from "./stunServer/index.ts";
import vite from "./vite/index.ts";
import webrtcsignaling from "./webrtcsignaling/index.ts";

export default mcpserver.register.register(
  apt,
  docker,
  nginx,
  nodejs,
  peerjs,
  pm2,
  publicSlice,
  sftp,
  ssh,
  stunServer,
  vite,
  webrtcsignaling,
);
