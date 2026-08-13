# src-lib

`src-lib` 用 Zustand 切片组合 Ubuntu 远端能力。每个生产者只维护自己的配置和 actions，跨能力流程通过主 store 的 `get()` 组合；外部直接消费同一个 store。

```ts
import ubuntuStore from "src-lib/index.ts";

await ubuntuStore.getState().SshActions.isRunning();
```

## 项目结构

```text
src-lib/
├── index.ts                         # 公共入口
│   └── default                      # 交付组合后的 Zustand vanilla store
├── store.ts                         # 只组合切片并注入配置持久化
├── Public/
│   └── store.ts                     # 公共配置生产者
│       └── Public                   # 域名与远端根目录
├── Ssh/
│   └── store.ts                     # SSH 配置与会话生产者
│       └── Ssh、SshActions          # 配置、isRunning、execute、runtime、dispose
├── Apt/
│   └── store.ts                     # Ubuntu 基础包生产者
│       └── AptActions               # isRemoteRunning
├── Nodejs/
│   └── store.ts                     # Node.js 配置与远端运行环境生产者
│       └── Nodejs、NodejsActions    # 配置、运行验证、部署依赖生成、生产依赖安装
├── Docker/
│   └── store.ts                     # Docker 运行环境生产者
│       └── DockerActions            # isRemoteRunning
├── Sftp/
│   └── store.ts                     # SFTP 文件传输生产者
│       └── SftpActions              # 文件传输、原子目录替换、远端文本读写
├── Pm2/
│   └── store.ts                     # PM2 运行环境生产者
│       └── Pm2Actions               # 运行验证、进程启动验证、进程关闭
├── Forward/
│   └── store.ts                     # SSH 远端转发生产者
│       └── ForwardActions           # register、dispose
├── Nginx/
│   └── store.ts                     # Nginx 配置与路由生产者
│       └── Nginx、NginxActions      # 配置、运行验证、反向代理、静态路由、关闭路由
├── Peerjs/
│   └── store.ts                     # PeerJS 配置与服务生产者
│       └── Peerjs、PeerjsActions    # 配置、isRemoteRunning
├── StunServer/
│   └── store.ts                     # STUN 配置与 Coturn 服务生产者
│       └── StunServer、StunServerActions # 配置、isRemoteRunning、vitePlugin
├── Webrtcsignaling/
│   └── store.ts                     # 私有信令配置、部署与专属 Vite 插件
│       └── Webrtcsignaling、WebrtcsignalingActions # 配置、register、isRemoteRunning、vitePlugin
└── Vite/
    └── store.ts                     # 无状态的构建流程消费者切片
        └── ViteActions              # forwardPlugin、staticPlugin、nodePlugin
```

配置持久化到 `~/.extends-ssh/.zustand/src-lib.json`。actions、NodeSSH、转发连接、子进程和运行中的 Promise 不进入持久化数据。
