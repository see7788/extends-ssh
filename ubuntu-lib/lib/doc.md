# lib 项目结构


```text
lib/
├── doc.md
├── slices.ts                         # MCP 切片聚合入口
├── public/                           # 公共内部契约和 Vite 业务基类
│   ├── Base.ts                       # 所有基础类继承的抽象基类
│   │   └── protected abstract remoteIsRunning(): Promise<unknown>
│   ├── ServerBase.ts                 # Vite 业务层抽象基类
│   │   ├── protected devPort: z.infer<typeof devPortValidator>
│   │   ├── protected projectPath: string
│   │   ├── public plugin: Plugin[]
│   │   ├── public addSftp(): this
│   │   ├── public addSshForward(): this
│   │   ├── public addNginx(): this
│   │   ├── public addPeerjs(): this
│   │   └── public addStunServer(): this
│   └── store.ts                      # 单服务器公共配置
├── localShell/                       # 本地命令和端口能力
│   └── store.ts                      # 根 store 成员 localShellActions
├── ssh/                              # 基础切片：SSH 连接和命令执行
│   ├── index.ts
│   │   ├── protected remoteIsRunning(): Promise<void>
│   │   ├── client: NodeSSH
│   │   ├── execute(command: string): Promise<SSHExecCommandResponse>
│   │   ├── hasPort(port: number): Promise<PortState>
│   │   └── dispose(): void
│   └── store.ts                      # SSH 连接配置
├── apt/                              # 基础切片：Ubuntu 基础依赖
│   └── index.ts
│       └── public remoteIsRunning(): Promise<void>
├── docker/                           # 基础切片：Docker daemon
│   └── index.ts
│       └── public remoteIsRunning(): Promise<void>
├── sftp/                             # 基础切片：按开发端口建立远程应用目录
│   ├── index.ts
│   │   ├── protected remoteIsRunning(): Promise<void>
│   │   ├── Remote = { path: string; hasRemote(): Promise<boolean> }
│   │   ├── makeRemote(input: { port: number; localPath: string }): Promise<Remote>
│   │   ├── hasRemote(port: number): Promise<boolean>
│   │   └── getRemote(port: number): Promise<Remote>
│   └── store.ts                      # SFTP 根目录配置
├── sshForward/                       # 基础切片：按开发端口建立 SSH 内网穿透
│   ├── index.ts
│   │   ├── protected remoteIsRunning(): Promise<void>
│   │   ├── Remote = { host: string; remotePort: number; hasRemote(): Promise<boolean>; close(): Promise<void> }
│   │   ├── makeRemote(port: number): Promise<Remote>
│   │   ├── getRemote(port: number): Promise<Remote>
│   │   ├── hasRemote(port: number): Promise<boolean>
│   │   ├── closeRemote(port: number): Promise<void>
│   │   └── dispose(): Promise<void>
│   └── store.ts                      # SSH 转发配置
├── nginx/                            # 基础切片：提供公网入口、子域名和路由
│   └── index.ts
│       ├── protected remoteIsRunning(): Promise<void>
│       ├── makeRemote(port: number): Promise<Remote>
│       ├── hasRemote(port: number): Promise<boolean>
│       ├── getRemote(port: number): Promise<Remote>
│       └── closeRemote(port: number): Promise<void>
├── nodejs/                           # 基础切片：远程 Node.js 运行环境
│   └── index.ts
│       └── public remoteIsRunning(): Promise<void>
├── pm2/                              # 基础切片：按开发端口管理远程进程
│   └── index.ts
│       ├── protected remoteIsRunning(): Promise<void>
│       ├── makeRemote(input: { port: number; command: string; environment?: Record<string, string> }): Promise<Remote>
│       ├── hasRemote(port: number): Promise<boolean>
│       ├── getRemote(port: number): Promise<Remote>
│       ├── refresh(port: number): Promise<"missing" | "stopped" | "running">
│       ├── stop(port: number): Promise<void>
│       ├── restart(port: number): Promise<void>
│       └── closeRemote(port: number): Promise<void>
├── peerjs/                           # 基础切片：固定 PeerJS 公共服务
│   ├── index.ts
│   │   └── public remoteIsRunning(): Promise<void>
│   └── store.ts                      # PeerJS 固定配置
├── stunServer/                       # 基础切片：固定 STUN 公共服务
│   ├── index.ts
│   │   └── public remoteIsRunning(): Promise<void>
│   └── store.ts                      # STUN 固定配置
└── store/                            # 持久化状态组合，不提供业务能力
    ├── index.ts
    └── type.ts
```

所有切片保持同一级目录和相同的入口风格。所有基础类统一继承 `public/Base.ts`；`ServerBase` 是供具体 Vite 项目继承的组合基类，不是对外提供资源的基础切片。

`ServerBase` 构造时固定开发端口并加入注册插件。具体业务通过链式方法选择需要的基础能力：

```ts
new ServerBase(3006)
  .addSftp()
  .addSshForward()
  .addNginx()
  .addPeerjs()
  .addStunServer()
  .plugin
```

每个 `add...()` 方法无参数并返回当前实例；插件内部根据 Vite 生命周期执行基础能力。项目路径由注册插件的 `configResolved` 写入 `projectPath`，SFTP 在 `closeBundle` 使用该路径。

开发端口是业务闭环的唯一主键，不建立端口映射，不做端口持久化，也不使用运行时端口锁。业务切片直接使用调用方提供的开发端口，并通过本地 `localShellActions.hasPort()` 或远程 `ssh.hasPort()` 查询实际占用情况。

服务器端口资源归具体能力切片管理：SshForward 管理内网穿透端口，Pm2 管理应用服务端口，Nginx 使用已有开发端口提供公网入口，Sftp 管理开发端口对应的远程目录。

`remoteIsRunning()` 是所有基础类统一的抽象运行检查方法。公开能力由各切片自身的业务方法提供；切片之间直接调用具体实例，不通过统一的 `ensure()` 契约。

根 store 只保存配置，不保存运行中的连接、进程、端口占用或远程资源状态。`localShellActions` 只提供本地命令执行和本地 TCP 端口查询：

```ts
store.getState().localShellActions.execute(command);
store.getState().localShellActions.hasPort(port);
```

本地命令能力与 SSH 远程命令能力相互独立。`getRemote()` 必须先检查对应的 `hasRemote()`；资源不存在或检查失败时抛出错误。所有远程资源状态以服务器实际查询结果为准。
