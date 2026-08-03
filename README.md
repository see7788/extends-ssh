# extends-ssh

私人云环境库。新入口从 `extends-ssh/Ubuntu/index.ts` 引入，当前完整交付 Vite 公网开发、
构建发布以及 WebRTC Proxy 云端运行数据；尚无新消费者目标的 PeerJS、Coturn 和邮件能力仍
保留在 `src/`，不提前迁移。

## Tree

```text
extends-ssh/
├── Ubuntu/
│   ├── index.ts
│   │   ├── vite: Vite  让 Vite 配置取得开发隧道与构建发布能力
│   │   └── webrtcProxy: WebrtcProxy  让 WebRTC 业务取得并保障信令与 STUN 数据
│   ├── store.ts
│   │   ├── ssh  交付 SSH 连接所需的外部固定数据
│   │   ├── mainDomain: string  交付已备案主域名
│   │   └── 组合 Vite/store、WebrtcProxy/store
│   ├── Vite/
│   │   ├── store.ts
│   │   │   └── vite.remoteRoot: string  交付上传与站点发布共用的远端根路径
│   │   └── index.ts
│   │       ├── honoReact(): Plugin  开发时建立隧道，构建时发布 Hono 与 React
│   │       ├── react(): Plugin  开发时建立隧道，构建时发布静态 React
│   │       └── electronRenderer(): Plugin  建立并清理 Electron Renderer 开发隧道
│   ├── WebrtcProxy/
│   │   ├── store.ts
│   │   │   └── webrtcProxy  交付信令端口、路径和 STUN 端口
│   │   └── index.ts
│   │       ├── state  交付 WebRTC Proxy 直接消费的完整连接数据
│   │       └── isRunning()  发布并验证信令、WebSocket 与 STUN 后返回 state
│   ├── public.ts  为上述服务提供 SSH、远程命令与 PM2 基本能力
│   └── README.md  记录新实现的完整公开成员、直接调用链与使用场景
├── src/
│   ├── Ubuntu.ts  尚未迁移的 PeerJS、Coturn、邮件等旧生产者
│   └── store.ts  只保存尚未迁移旧生产者仍消费的数据
├── package.json
└── tsconfig.json
```

## 核心使用

Vite 配置直接消费与项目场景对应的插件：

```ts
import ubuntu from "extends-ssh/Ubuntu/index.ts";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  plugins: [ubuntu.vite.honoReact()],
});
```

WebRTC 业务先保障云端服务，再读取同一生产者交付的完整数据：

```ts
import ubuntu from "extends-ssh/Ubuntu/index.ts";

const state = await ubuntu.webrtcProxy.isRunning();
```

四类 Vite 场景和 WebRTC 完整消费示例见
[`Ubuntu/README.md`](Ubuntu/README.md)。
