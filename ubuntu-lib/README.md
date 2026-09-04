# extends-ssh

extends-ssh 是一个个人单服务器中心：通过一条 SSH 连接，把 Ubuntu 上的 Node.js、PM2、Nginx、Docker、SFTP、端口转发、PeerJS、STUN 和 WebRTC 信令能力组合成可复用的运行时。Vite 应用只需从 ubuntu-lib/index.ts 取得 ubuntu 单例并组合插件；AI 或运维工具直接加载 ubuntu-lib/slices.ts 获取同构的 MCP 切片。项目默认把运行配置持久化到 ~/.extends-ssh，生产使用前必须替换 ubuntu-lib/Ssh/store.ts 中的连接配置，并且不要提交真实密码。最短的 Vite 接入方式是在具体 application 包中声明 ubuntu-lib 和 Vite，固定 server.port，然后把适用的插件放入 vite.config.ts（Electron 使用 electron.vite.config.ts）。如果由 3005 的 MCP 中心协助接入，先读取 vite.readme 资源，再使用 vite.projectRead、vite.dependenciesInstall 和 vite.importsEnsure 完成识别、依赖与导入检查。

## 项目结构

~~~text
extends-ssh/
├── ubuntu-lib/                         # 被 Vite 项目直接消费的运行时库
│   ├── index.ts                         # 只组合并暴露根级 ubuntu 单例
│   │   ├── ssh                         # SSH 配置、连接、命令执行与释放
│   │   ├── apt                         # Ubuntu Apt 基础依赖保障
│   │   ├── nodejs                      # 固定版本 Node.js 保障与生产依赖安装
│   │   ├── docker                      # Docker daemon 保障
│   │   ├── sftp                        # 本地与远端文件传输
│   │   ├── pm2                         # PM2 daemon 与进程生命周期
│   │   ├── forward                      # SSH 端口转发注册与关闭
│   │   ├── nginx                        # HTTPS、静态资源与反向代理路由
│   │   ├── peerjs                       # PeerJS 公共服务
│   │   ├── stunServer                   # Coturn/STUN 公共服务
│   │   ├── vite                         # Vite 开发转发与生产发布插件
│   │   └── webrtcsignaling               # WebRTC 信令服务与专属 Vite 插件
│   ├── Apt/index.ts                     # 远端 Apt 基础组件
│   │   └── isRemoteRunning()             # 幂等安装并验证 lsof、curl、ufw 等命令
│   ├── Docker/index.ts                   # 远端 Docker 运行时
│   │   └── isRemoteRunning()             # 安装、启动并验证 Docker daemon
│   ├── Forward/index.ts                  # SSH 反向转发
│   │   ├── register()                    # 注册本地/远端端点，按 name 复用
│   │   ├── registered.state              # 只读转发配置
│   │   ├── registered.isRunning()        # 建立转发并返回实际 remotePort
│   │   ├── registered.close()            # 关闭转发及活动连接
│   │   └── dispose()                     # 关闭全部转发
│   ├── Nginx/index.ts                    # 远端 Nginx 与证书路由
│   │   ├── state                        # domain、httpPort、httpsPort、secure
│   │   ├── isRemoteRunning()             # 验证 Nginx、Certbot 与防火墙
│   │   ├── proxyRouteIsRunning(route)    # 写入 HTTPS 反向代理路由
│   │   ├── staticRouteIsRunning(route)   # 写入 HTTPS 静态资源路由
│   │   └── routeClose(route)             # 删除路由并 reload Nginx
│   ├── Nodejs/index.ts                   # 远端 Node.js 与部署包
│   │   ├── isRemoteRunning()             # 安装并校验固定 Node.js 版本
│   │   ├── deploymentPackageCreate()    # 从构建产物解析外部依赖并生成 package.json
│   │   └── dependenciesRemoteInstall()  # 在远端项目目录安装生产依赖
│   ├── Pm2/index.ts                      # PM2 进程生产者
│   │   ├── state                        # host、status、updatedAt 与进程摘要
│   │   ├── isRunning()/refresh()         # 保障 daemon 并读取完整进程状态
│   │   ├── stop(id)/restart(id)          # 操作指定 PM2 进程并刷新状态
│   │   ├── processIsRemoteRunning()      # 启动命名进程并验证目标端口
│   │   ├── processRemoteClose(name)      # 停止命名进程
│   │   └── dispose()                     # 释放 PM2 使用的 SSH 会话
│   ├── Sftp/index.ts                     # 双向 SFTP 文件能力
│   │   ├── state                         # remoteRoot
│   │   ├── remotePath(name)               # 解析 SFTP 管理的远端应用根目录
│   │   ├── remoteExecute(command)         # 统一执行应用目录相关远端操作
│   │   ├── remoteUpload()/remoteDirectoryUpload()   # 上传文件或目录
│   │   ├── remoteDirectoryReplace()     # 原子替换远端目录，失败保留旧目录
│   │   ├── remoteTextUpload()/remoteTextRead()      # 写入或读取远端文本
│   │   └── locDownload()                 # 下载远端文件到本地
│   ├── Ssh/index.ts                      # SSH 会话边界
│   │   ├── state                        # host、port、username、password（仅库内使用）
│   │   ├── revision                     # 连接版本号，供转发失效检测
│   │   ├── isRunning()/execute(command)  # 建立连接、执行并校验远程命令
│   │   └── dispose()                     # 释放当前连接
│   ├── Peerjs/index.ts                   # PeerJS 公共服务
│   │   ├── state                        # host、port、path、secure、key
│   │   └── isRemoteRunning()             # 保障 Docker 容器、Nginx 路由和公网健康检查
│   ├── StunServer/index.ts               # STUN 公共服务
│   │   ├── state                        # host、port、secure=false
│   │   ├── isRemoteRunning()             # 保障 Coturn、UDP/TCP 防火墙与 STUN 响应
│   │   └── vitePlugin()                  # 注入 globalThis.WEBRTC_STUN_URL
│   ├── Vite/index.ts                     # Vite 接入与发布编排
│   │   ├── projectRead({ projectPath })  # 识别 application profile 与公开表达式
│   │   ├── dependenciesInstall()        # 补齐 ubuntu-lib、Vite devDependencies 并 pnpm install
│   │   ├── importsEnsure()               # 为项目内 .ts 文件补齐 ubuntu 导入
│   │   ├── state(port)                   # 返回 vite-<port>.dev.<domain> 的 HTTPS 地址
│   │   ├── dev.forward()                # 开发服务器监听后建立 SSH 转发并接入 Nginx
│   │   └── pro.sftp()/pro.nodejs()       # 构建后发布静态站点或 Node.js 服务
│   ├── Webrtcsignaling/                  # WebRTC 信令服务
│   │   ├── index.ts                     # state、isRemoteRunning()、vitePlugin(options)
│   │   ├── vitePlugin.ts                # 开发代理、tsx 子进程、构建报备与关闭清理
│   │   └── store.ts                     # entry、path、固定 listenPort=9001、pathname=/signal
│   ├── store/                            # 内部 Zustand 持久化主仓库，不是业务消费入口
│   │   ├── index.ts                     # cwdPersist 到 ~/.extends-ssh，并组合配置切片
│   │   └── type.ts                      # 组合 Store 类型
│   ├── Public/index.ts                   # 公共域名 class 与 MCP slice
│   ├── Public/store.ts                   # domain 默认配置
│   ├── Sftp/store.ts                      # remoteRoot 默认配置
│   ├── Ssh/store.ts                      # SSH host、port、username、password 配置
│   ├── Peerjs/store.ts                   # PeerJS 镜像、key、端口与路径
│   ├── StunServer/store.ts               # STUN 端口（默认 3478）
│   ├── slices.ts                          # 汇总所有同构 MCP slice
│   ├── mcpBase.ts                          # MCP 注册的公共类型与注解
│   └── package.json                      # ubuntu-lib 包边界与 Vite peerDependency
└── pnpm-workspace.yaml                   # 本地包及其 workspace 依赖
~~~

## Vite 接入

projectRead 只接受具体 application 包，不接受 workspace 根、extends-* 包或 *-lib 包。项目必须声明 ubuntu-lib，并满足以下 profile 与配置文件约束：

| package.json.tpltype | 必须存在的配置 | MCP 返回的公开表达式 |
| --- | --- | --- |
| node-application | vite.config.ts | ubuntu.vite.pro.nodejs() |
| hono-application | vite.config.ts，且声明 hono | ubuntu.vite.dev.forward()、ubuntu.vite.pro.nodejs() |
| electron-vite-application | electron.vite.config.ts，且声明 electron-vite | ubuntu.vite.dev.forward() |

所有 profile 都要求 server.port 是 1–65535 之间的固定整数。端口既是开发转发的本地端口，也是生产域名 vite-<port>.dev.<主域名> 的稳定标识。

### Node.js Vite 服务

~~~ts
import ubuntu from "ubuntu-lib/index.ts";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 8788 },
  plugins: [ubuntu.vite.pro.nodejs()],
});
~~~

pro.nodejs() 在 closeBundle 中检查 dist，根据构建产物解析外部依赖，上传 dist 与生产 package.json，远端执行 npm install --omit=dev，通过 PM2 以 vite-node-8788 启动 node dist/<package-name>/index.js，最后写入 Nginx 反向代理并做公网校验。

### Hono 或需要公网开发转发的 Vite 服务

~~~ts
import ubuntu from "ubuntu-lib/index.ts";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 8789 },
  plugins: [
    ubuntu.vite.dev.forward(),
    ubuntu.vite.pro.nodejs(),
  ],
});
~~~

dev.forward() 只在 serve 阶段生效：强制监听 127.0.0.1 与固定端口，建立到远端随机端口的 SSH 转发，把 vite-8789.dev.<主域名> 指向该转发，并用 /__vite_ping 验证。开发服务器关闭时会根据远端 .extends-ssh-kind 恢复上一条静态或 Node 路由。

### 静态产物发布

需要发布纯静态站点时，直接使用 ubuntu.vite.pro.sftp()。它会原子替换远端站点目录，停止同端口的 vite-node-<port>，标记 .extends-ssh-kind=static，配置 Nginx SPA 路由并验证公网首页。

### Electron Renderer

~~~ts
import ubuntu from "ubuntu-lib/index.ts";
import { defineConfig } from "electron-vite";

export default defineConfig({
  renderer: {
    plugins: [ubuntu.vite.dev.forward()],
  },
});
~~~

Electron 项目使用 electron.vite.config.ts，由 Electron 自己组合 main、preload 与 renderer；ubuntu.vite.dev.forward() 放在实际提供 Vite HTTP server 的 renderer 配置中。

## WebRTC 信令与 STUN

信令源码项目使用 { entry } 形式的专属插件；当前实现不再接收 jwtSecret。entry 必须是项目根目录内的 .ts 或 .tsx 文件，且信令项目必须在 package.json 的 dependencies 中声明 tsx。插件会把开发服务固定在本机 9001，把源码 tsx watch 子进程放在 9002，注入 WEBRTC_SIGNALING_HOSTNAME、WEBRTC_SIGNALING_PATH、WEBRTC_SIGNALING_PORT，构建结束后自动报备源码入口并提交远端 PM2/Nginx 服务。

~~~ts
import ubuntu from "ubuntu-lib/index.ts";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    ubuntu.webrtcsignaling.vitePlugin({
      entry: "./server.ts",
    }),
  ],
});
~~~

普通业务项目以 { projectName } 形式消费信令服务；插件通过 define 注入 globalThis.WEBRTC_PROJECT_NAME 和 globalThis.WEBRTC_SIGNALING_URL。需要时可把信令和 STUN 消费插件一起放进业务 Vite 配置：

~~~ts
import ubuntu from "ubuntu-lib/index.ts";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    ubuntu.webrtcsignaling.vitePlugin({ projectName: "chat-web" }),
    ubuntu.stunServer.vitePlugin(),
  ],
});
~~~

STUN 消费者可读取 globalThis.WEBRTC_STUN_URL，也可以直接读取公开状态：

~~~ts
import ubuntu from "ubuntu-lib/index.ts";

const signalingServer = ubuntu.webrtcsignaling.state;
const stunServer = ubuntu.stunServer.state;
const signalingUrl = (signalingServer.secure ? "wss://" : "ws://")
  + signalingServer.host + ":" + signalingServer.port + signalingServer.path;
const stunUrl = (stunServer.secure ? "stuns:" : "stun:")
  + stunServer.host + ":" + stunServer.port;
~~~

webrtcsignaling.isRemoteRunning() 会检查源码报备、远端发布 revision、PM2 健康状态、HTTPS JSON 响应和 WebSocket 握手；stunServer.isRemoteRunning() 会保障 Coturn 容器、TCP/UDP 防火墙并发送真实 STUN binding request。

## MCP 与 3005

每个具体切片的 index.ts 都按“验证器 → class → singleton → MCP 注册”的顺序组织。MCP 注册位于对应 class 文件底部，不进入 class；ubuntu-lib/slices.ts 只负责聚合这些同构切片并导出 ubuntu MCP endpoint。当前提供 13 个 slice：apt、docker、forward、nginx、nodejs、peerjs、pm2、public、sftp、ssh、stunServer、vite、webrtcsignaling。

人类查阅入口使用 GET resource；例如 3005 的项目目录会展示 vite.readme 的 GET 路由并返回本 README。工具本身按代码中的 MCP 注册保持 POST，并由宿主按 catalog 前缀挂载：

~~~text
GET  /<catalog>/vite/readme
POST /<catalog>/vite/projectRead
POST /<catalog>/vite/dependenciesInstall
POST /<catalog>/vite/importsEnsure
POST /<catalog>/vite/state
~~~

典型的 AI 接入顺序是：

1. 读取 vite.readme，获得公开约定和 profile 表达式。
2. 调用 vite.projectRead({ projectPath })，确认这是具体 application 包、配置文件和可用表达式。
3. 必要时调用 vite.dependenciesInstall({ projectPath })，补齐当前约定的 ubuntu-lib: workspace:* 与 vite: ^8.0.11 并执行 pnpm install。
4. 对已有 TypeScript 配置调用 vite.importsEnsure({ projectPath, sourceFilePath })，只会修改项目内部已有的 .ts 文件，不修改 .d.ts。
5. 由应用自己的 Vite 配置消费 ubuntu.vite.* 插件；远端保障类工具（如 nginx.ensure、pm2.refresh）按需调用。

SSH 密码永远不会由 ssh/config、ssh/state 或 public/state MCP 路由返回；密码只存在于 ubuntu-lib 内部 SSH 状态，调用方应把它视为敏感配置。

## 运行时边界

~~~text
ubuntu.ssh
├── apt.isRemoteRunning()
│   ├── nodejs.isRemoteRunning()
│   │   └── pm2.isRemoteRunning()/processIsRemoteRunning()
│   └── docker.isRemoteRunning()
│       ├── peerjs.isRemoteRunning()
│       └── stunServer.isRemoteRunning()
├── sftp.remoteUpload()/remoteDirectoryReplace()
├── forward.register().isRunning()
└── nginx.isRemoteRunning()/proxyRouteIsRunning()/staticRouteIsRunning()
~~~

这些对象都由各自模块通过顶部 import 直接消费其他服务实例，再由 ubuntu-lib/index.ts 统一导出；各服务 class 不接收依赖构造参数，外部不需要创建第二个 store、倒腾构造器或自行拼接 SSH 会话。业务消费优先读取 state；需要产生远端副作用时，显式调用对应的 isRemoteRunning、发布、路由或进程方法。

## 本地验证

~~~bash
pnpm --filter ubuntu-lib typecheck
~~~

ubuntu-lib 同时提供 Vite 应用运行时与 MCP 切片；主 store 仍只在 ubuntu-lib 内部组合，远程根目录 remoteRoot 只由 SFTP 切片消费。
