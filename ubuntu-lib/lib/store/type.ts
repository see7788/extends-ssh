import type peerjsStore from "../Peerjs/store.ts";
import type publicStore from "../Public/store.ts";
import type sftpStore from "../Sftp/store.ts";
import type sshStore from "../Ssh/store.ts";
import type stunServerStore from "../StunServer/store.ts";

export type Store = ReturnType<typeof publicStore>
  & ReturnType<typeof peerjsStore>
  & ReturnType<typeof sftpStore>
  & ReturnType<typeof sshStore>
  & ReturnType<typeof stunServerStore>;





export type StoreShape = {
  domain: string; // 单服务器公网域名
  peerjs: { // 固定 PeerJS 公共服务配置
    image: string; // PeerJS 容器镜像
    key: string; // PeerJS 连接密钥
    listenPort: number; // PeerJS 容器本地监听端口
    pathname: string; // PeerJS 公网路径
  };
  sftp: { // SFTP 远程应用目录配置
    remoteRoot: string; // 远程应用目录根路径
  };
  ssh: { // 单服务器 SSH 连接配置
    host: string; // SSH 主机地址
    port: number; // SSH 服务端口
    username: string; // SSH 用户名
    password: string; // SSH 密码
  };
  stunServer: { // 固定 STUN 公共服务配置
    port: number; // STUN 服务端口
  };
};









