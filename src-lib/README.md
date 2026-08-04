# src-lib

旧版私人云环境生产者；从 `src-lib/Ubuntu.ts` 引入现有单例后，直接消费尚未迁移的
SSH、Node、Docker、PeerJS、Coturn 与邮件服务能力。

## Tree

```text
src-lib/
├── Ubuntu.ts
│   ├── sshIsConnect(): Promise<void>  建立并维护旧 SSH 会话
│   ├── execCommand(command: string)  执行远程命令并返回正式结果
│   ├── dispose(): void  关闭旧 SSH 会话
│   ├── nvmInstalled(): Promise<void>  保障旧 Node 运行环境
│   ├── httpserverIsInstalled(): Promise<void>  保障旧静态服务环境
│   ├── pm2IsRunning(): Promise<void>  保障旧 PM2 运行环境
│   ├── dockerIsRunning(): Promise<void>  保障旧 Docker 运行环境
│   ├── portInUse(port: number, protocol?: "tcp" | "udp"): Promise<boolean>  读取端口状态
│   ├── portClose(port: number): Promise<void>  关闭占用指定端口的服务
│   ├── coturnIsRunning(): Promise<void>  保障旧 Coturn 服务
│   ├── peerjsIsRunning(): Promise<void>  保障旧 PeerJS 服务
│   ├── emailSmtpIsRunning(): Promise<void>  保障旧邮件服务
│   └── readonly peerjsState  交付旧 PeerJS 与 STUN 连接数据
└── store.ts
    └── default: zustand.StoreApi  维护旧生产者消费的 SSH 与服务状态
```

## 核心使用

```ts
import ssh from "src-lib/Ubuntu.ts";

await ssh.sshIsConnect();
```
