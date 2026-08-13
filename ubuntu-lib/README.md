# ubuntu-lib

`ubuntu-lib` 为 Vite、WebRTC 信令、STUN 和 PM2 分别提供独立的云端生产者。外部 Vite 服务
从 `ubuntu-lib/index.ts` 取得专属插件；插件自动报备真实构建产物，并在构建结束后提交和验证
服务。业务消费者只读取对应生产者的 `state`。

```text
ubuntu-lib/
├── index.ts                 # 包入口，只组合并暴露根级生产者
│   ├── forward: Forward  维护本地、远端端点组成的 SSH 转发
│   ├── sftp: Sftp  交付本地与远端之间的双向文件传输
│   ├── stunServer: StunServer  交付 STUN 数据并保障 Coturn
│   ├── webrtcsignaling: Webrtcsignaling  交付并保障 WebRTC 信令
│   ├── vite: Vite  交付开发隧道与构建发布能力
│   └── pm2: Pm2  交付并维护远程 PM2 进程数据
├── store.ts                 # 内部主仓库，只组合根配置和独立切片
│   ├── ssh  SSH 连接所需的外部固定数据
│   ├── mainDomain: string  已备案主域名；Vite 据此生产端口子域名
│   ├── remoteRoot: string  所有远端发布共同使用的私有根路径
│   └── 组合 StunServer、Webrtcsignaling 配置切片
├── Forward/
│   └── index.ts             # 单 class 的 SSH 端口转发生产者
│       ├── register()  注册一组本地、远端配置并返回运行时实例
│       │   ├── readonly state  只交付 name、local、remote 配置
│       │   ├── isRunning()  当次保障隧道并返回 remotePort
│       │   └── close()  关闭当前隧道
│       └── dispose()  关闭全部转发及共享 SSH 会话
├── Sftp/
│   └── index.ts             # 双向 SFTP 生产者
│       ├── remoteUpload()  把本地文件上传到远端
│       ├── locDownload()  把远端文件下载到本地
│       └── dispose()  关闭当前 SFTP 对象共用的 SSH 会话
├── StunServer/
│   ├── store.ts             # STUN 服务配置切片
│   │   └── stunServer.port: number  Coturn 独占端口
│   └── index.ts             # STUN 服务生产者
│       ├── readonly state  交付 host、port 和 secure
│       └── isRemoteRunning(): Promise<void>  保障 Coturn 并验证公网 STUN 响应
├── Webrtcsignaling/
│   ├── store.ts             # WebRTC 信令专属切片
│   │   ├── webrtcsignaling  仅保存外部产物路径、JWT secret、信令端口和路径
│   │   └── webrtcsignalingActions.register()  接收专属 Vite 插件的路径和 JWT secret 报备
│   ├── vitePlugin.ts        # WebRTC 信令专属 Vite 生命周期
│   │   └── 统一开发代理、源码进程、服务环境、构建输出识别和构建后提交
│   └── index.ts             # WebRTC 信令生产者
│       ├── readonly state  交付 host、port、path 和 secure
│       ├── isRemoteRunning(): Promise<void>  无参数发布并验证 HTTP、凭证和 WebSocket 信令
│       └── vitePlugin({ entry, jwtSecret }): Plugin  只接收外部实现不可推导的源码事实
├── Vite/
│   └── index.ts             # Vite 公网开发与发布消费场景
│       ├── honoReact(): Plugin  开发时建立隧道，构建时发布 Hono 与全部 React 产物
│       │   └── 调用 store.mainDomain、store.remoteRoot、Public.sshIsRunning()、
│       │       Public.sftp.remoteUpload()、Public.execute()、Public.pm2IsRunning()
│       ├── react(): Plugin  开发时建立隧道，构建时由 Nginx 直接发布 React 产物
│       │   └── 调用 store.mainDomain、store.remoteRoot、Public.sshIsRunning()、
│       │       Public.sftp.remoteUpload()、Public.execute()
│       └── electronRenderer(): Plugin  为两种 Electron Renderer 场景建立开发隧道
│           └── 调用 store.mainDomain、store.remoteRoot、Public.sshIsRunning()、
│               Public.ssh.forwardIn()、Public.execute()
├── Pm2.ts                  # Ubuntu PM2 运行时数据生产者
│   ├── readonly state  交付服务器地址、daemon 状态、更新时间与完整进程列表
│   ├── isRunning(): Promise<typeof state>  确保 PM2 可用并刷新完整进程数据
│   │   └── 调用 Public.pm2IsRunning()、Pm2.refresh()
│   ├── refresh(): Promise<typeof state>  从 PM2 daemon 读取并校验完整进程数据
│   │   └── 调用 Public.execute()
│   ├── stop(id: number): Promise<typeof state>  停止指定 PM2 进程并刷新完整数据
│   │   └── 调用 Public.pm2IsRunning()、Public.execute()、Pm2.refresh()
│   ├── restart(id: number): Promise<typeof state>  重启指定 PM2 进程并刷新完整数据
│   │   └── 调用 Public.pm2IsRunning()、Public.execute()、Pm2.refresh()
│   └── dispose(): void  关闭当前 PM2 生产者持有的 SSH 会话
│       └── 调用 Public.dispose()
└── public.ts                # 新服务共同消费的 SSH、命令与 PM2 基本能力
    ├── readonly ssh: NodeSSH  让底层生产者执行 SSH 命令与端口转发
    ├── readonly sftp: Sftp  在当前 SSH 会话上组合双向文件传输
    ├── sshIsRunning(): Promise<void>  确保当前服务实例拥有可用 SSH 会话
    │   └── 调用 store.ssh、NodeSSH.connect()、NodeSSH.execCommand()
    ├── execute(command: string): Promise<SSHExecCommandResponse>  执行并校验远程命令
    │   └── 调用 Public.sshIsRunning()、NodeSSH.execCommand()
    ├── pm2IsRunning(): Promise<void>  确保远程 Node 项目拥有持久 PM2 运行环境
    │   └── 调用 Public.execute()
    ├── serviceIsRunning(): Promise<void>  原子发布专属生产者提交的单文件 Node 服务
    │   └── 调用 Public.pm2IsRunning()、Public.execute()、Public.sftp.remoteUpload()
    └── dispose(): void  关闭当前服务实例持有的 SSH 会话
        └── 调用 NodeSSH.dispose()
```

Hono 与多个 React 项目：

```ts
import ubuntu from "ubuntu-lib/index.ts";
import honoReact from "vite-config-lib/plugin";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  plugins: [
    honoReact(
      {
        honoEntry: "src/index.ts",
        honoHost: "127.0.0.1",
        honoPort: [3005, 3111],
      },
      ["../reactapp"],
    ),
    ubuntu.vite.honoReact(),
  ],
});
```

普通 React 静态站点：

```ts
import react from "@vitejs/plugin-react";
import ubuntu from "ubuntu-lib/index.ts";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5174 },
  plugins: [react(), ubuntu.vite.react()],
});
```

普通 Electron React Renderer：

```ts
import ubuntu from "ubuntu-lib/index.ts";
import rendererReact from "electron-vite-config-lib/rendererReactPlugin/plugin";
import { defineConfig } from "electron-vite";

export default defineConfig({
  renderer: {
    plugins: [
      rendererReact({ otherPort: 8887 }, ["."]),
      ubuntu.vite.electronRenderer(),
    ],
  },
});
```

Electron Hono 与多个 React Renderer：

```ts
import react from "@vitejs/plugin-react";
import ubuntu from "ubuntu-lib/index.ts";
import { rendererHonoReact } from "electron-vite-config-lib/rendererReactPlugin/plugin";
import { defineConfig } from "electron-vite";

const honoReact = rendererHonoReact(
  { honoHost: "127.0.0.1", honoPort: [8788, 8789] },
  ["../admin-web"],
  ["../user-web"],
);

export default defineConfig({
  main: {
    plugins: [honoReact.main],
  },
  renderer: {
    plugins: [react(), honoReact.renderer, ubuntu.vite.electronRenderer()],
  },
});
```

WebRTC 信令源码项目直接在 Vite 配置中使用专属插件。外部只提供源码入口和 JWT secret；
插件统一完成开发代理、源码进程、环境注入、构建、真实产物报备和远端提交，不需要额外的
Vite 辅助文件或报备文件：

```ts
import ubuntu from "ubuntu-lib/index.ts";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    ubuntu.webrtcsignaling.vitePlugin({
      entry: "./server.ts",
      jwtSecret: "webrtcsignaling-open-issuer",
    }),
  ],
});
```

外部消费者不接触主 store、产物路径、JWT secret 或部署方法，只消费对应切片公开对象交付的
`state`：

```ts
import ubuntu from "ubuntu-lib/index.ts";

const signalingServer = ubuntu.webrtcsignaling.state;
const stunServer = ubuntu.stunServer.state;
const signalingProtocol = signalingServer.secure ? "wss" : "ws";
const stunProtocol = stunServer.secure ? "stuns" : "stun";
const signaling = new WebSocket(
  `${signalingProtocol}://${signalingServer.host}:${signalingServer.port}${signalingServer.path}`,
);
const connection = new RTCPeerConnection({
  iceServers: [{ urls: `${stunProtocol}:${stunServer.host}:${stunServer.port}` }],
});
```
