# ubuntu-lib

`ubuntu-lib` 为 Vite、WebRTC 信令、STUN 和 PM2 分别提供独立的云端生产者。库外统一从
`ubuntu-lib/index.ts` 引入 `ubuntu`，通过具体成员的 `state` 和方法消费能力。

```text
ubuntu-lib/
├── index.ts                 # 包入口，只组合并暴露根级生产者
│   ├── forwardLoc: ForwardLoc  维护 SSH 本地端口转发
│   ├── forwardRemote: ForwardRemote  发布并保障远端服务
│   ├── stunServer: StunServer  交付 STUN 数据并保障 Coturn
│   ├── webrtcProxy: WebrtcProxy  交付并保障 WebRTC 信令
│   ├── vite: Vite  交付开发隧道与构建发布能力
│   └── pm2: Pm2  交付并维护远程 PM2 进程数据
├── store.ts                 # 内部主仓库，只组合根配置和独立切片
│   ├── ssh  SSH 连接所需的外部固定数据
│   ├── mainDomain: string  已备案主域名；Vite 据此生产端口子域名
│   └── 组合 ForwardLoc、ForwardRemote、StunServer、WebrtcProxy、Vite 切片
├── ForwardLoc/
│   ├── store.ts             # 本地端口转发切片
│   └── index.ts             # SSH 端口转发生产者
│       └── register()  创建并维护具体本地端口转发
├── ForwardRemote/
│   ├── store.ts             # 远端服务发布配置切片
│   │   └── forwardRemote  保存产物路径、远端路径和 JWT secret
│   └── index.ts             # 远端服务发布生产者
│       └── isRunning(): Promise<void>  发布目标版本并验证 PM2 与健康接口
├── StunServer/
│   ├── store.ts             # STUN 服务配置切片
│   │   └── stunServer.port: number  Coturn 独占端口
│   └── index.ts             # STUN 服务生产者
│       ├── readonly state  交付 host、port 和 secure
│       └── isRunning(): Promise<typeof state>  保障 Coturn 并验证公网 STUN 响应
├── WebrtcProxy/
│   ├── store.ts             # WebRTC 信令配置切片
│   │   └── webrtcProxy  保存信令端口和路径
│   └── index.ts             # WebRTC 信令生产者
│       ├── readonly state  交付 host、port、path 和 secure
│       └── isRunning(): Promise<typeof state>  发布并验证 HTTP、凭证和 WebSocket 信令
├── Vite/
│   ├── store.ts             # Vite 数据切片
│   │   └── vite.remoteRoot: string  交付 SFTP 上传和站点发布共同使用的远端根路径
│   └── index.ts             # Vite 公网开发与发布消费场景
│       ├── honoReact(): Plugin  开发时建立隧道，构建时发布 Hono 与全部 React 产物
│       │   └── 调用 store.mainDomain、store.vite.remoteRoot、Public.sshIsRunning()、
│       │       Public.ssh.putFile()、Public.execute()、Public.pm2IsRunning()
│       ├── react(): Plugin  开发时建立隧道，构建时由 Nginx 直接发布 React 产物
│       │   └── 调用 store.mainDomain、store.vite.remoteRoot、Public.sshIsRunning()、
│       │       Public.ssh.putFile()、Public.execute()
│       └── electronRenderer(): Plugin  为两种 Electron Renderer 场景建立开发隧道
│           └── 调用 store.mainDomain、store.vite.remoteRoot、Public.sshIsRunning()、
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
    ├── readonly ssh: NodeSSH  让服务执行 SFTP 上传与 SSH 反向端口转发
    ├── sshIsRunning(): Promise<void>  确保当前服务实例拥有可用 SSH 会话
    │   └── 调用 store.ssh、NodeSSH.connect()、NodeSSH.execCommand()
    ├── execute(command: string): Promise<SSHExecCommandResponse>  执行并校验远程命令
    │   └── 调用 Public.sshIsRunning()、NodeSSH.execCommand()
    ├── pm2IsRunning(): Promise<void>  确保远程 Node 项目拥有持久 PM2 运行环境
    │   └── 调用 Public.execute()
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

分别启动并消费 WebRTC 信令与 STUN 数据：

```ts
import ubuntu from "ubuntu-lib/index.ts";

await Promise.all([
  ubuntu.webrtcProxy.isRunning(),
  ubuntu.stunServer.isRunning(),
]);
const peerServer = ubuntu.webrtcProxy.state;
const stunServer = ubuntu.stunServer.state;
const signalingProtocol = peerServer.secure ? "wss" : "ws";
const stunProtocol = stunServer.secure ? "stuns" : "stun";
const signaling = new WebSocket(
  `${signalingProtocol}://${peerServer.host}:${peerServer.port}${peerServer.path}`,
);
const connection = new RTCPeerConnection({
  iceServers: [{ urls: `${stunProtocol}:${stunServer.host}:${stunServer.port}` }],
});
```
