# Ubuntu 服务实现

`Ubuntu/` 为 Vite 项目生产公网运行结果，并交付 WebRTC Proxy 需要的已验证云端数据；从
`extends-ssh/Ubuntu/index.ts` 引入 `ubuntu` 后注册对应插件或保障 WebRTC 服务。`src/` 只保留
尚未迁移的 PeerJS、Coturn、邮件等旧能力，后续仍按“实现、验证、迁移、删除”逐个收口。

```text
Ubuntu/
├── index.ts                 # 新入口，只组合成品业务需要的对象
│   ├── vite: Vite  让 Vite 配置取得开发隧道与构建发布能力
│   ├── webrtcProxy: WebrtcProxy  让 WebRTC 业务取得并保障信令与 STUN 数据
│   └── pm2: Pm2  让具体业务取得并维护远程 PM2 进程数据
├── store.ts                 # 新实现主仓库，定义总成输入并组合具体数据切片
│   ├── ssh  SSH 连接所需的外部固定数据
│   ├── mainDomain: string  已备案主域名；Vite 据此生产端口子域名
│   └── 组合 Vite/store、WebrtcProxy/store
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
├── WebrtcProxy/
│   ├── store.ts             # WebrtcProxy 数据切片
│   │   └── webrtcProxy  交付信令端口、路径和 STUN 端口
│   └── index.ts             # WebRTC Proxy 信令与 STUN 数据生产者
│       ├── readonly state: {
│       │     peerServer: { host: string; port: number; path: string; secure: false };
│       │     stunServer: { host: string; port: number; secure: false };
│       │   }  交付 webrtc-proxy 直接消费的信令与 STUN 连接数据
│       │   └── 调用 store.ssh、store.webrtcProxy
│       └── isRunning(): Promise<typeof state>  发布并验证信令、WebSocket 与 STUN
│           └── 调用 state、Public.pm2IsRunning()、Public.ssh.putFile()、Public.execute()
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
src/
├── Ubuntu.ts                # 尚未迁移的旧服务入口
│   ├── sshIsConnect()、execCommand()、dispose()  提供旧 SSH 生命周期与命令能力
│   ├── nvmInstalled()、httpserverIsInstalled()、pm2IsRunning()  保障旧 Node 运行环境
│   ├── dockerIsRunning()、portInUse()、portClose()  保障旧容器与端口环境
│   ├── coturnIsRunning()、peerjsIsRunning()  保障旧 PeerJS 与 Coturn 服务
│   ├── emailSmtpIsRunning()  保障旧 SMTP 服务
│   └── peerjsState  交付旧 PeerJS 与 STUN 数据
└── store.ts                 # 只保存上述未迁移旧能力仍在消费的数据
```

Hono 与多个 React 项目：

```ts
import ubuntu from "extends-ssh/Ubuntu/index.ts";
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
import ubuntu from "extends-ssh/Ubuntu/index.ts";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5174 },
  plugins: [react(), ubuntu.vite.react()],
});
```

普通 Electron React Renderer：

```ts
import ubuntu from "extends-ssh/Ubuntu/index.ts";
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
import ubuntu from "extends-ssh/Ubuntu/index.ts";
import rendererHonoReact from "electron-vite-config-lib/rendererHonoReactPlugin/plugin";
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

WebRTC Proxy 启动并消费完整数据：

```ts
import ubuntu from "extends-ssh/Ubuntu/index.ts";

await ubuntu.webrtcProxy.isRunning();
const { peerServer, stunServer } = ubuntu.webrtcProxy.state;
const signalingProtocol = peerServer.secure ? "wss" : "ws";
const stunProtocol = stunServer.secure ? "stuns" : "stun";
const signaling = new WebSocket(
  `${signalingProtocol}://${peerServer.host}:${peerServer.port}${peerServer.path}`,
);
const connection = new RTCPeerConnection({
  iceServers: [{ urls: `${stunProtocol}:${stunServer.host}:${stunServer.port}` }],
});
```
