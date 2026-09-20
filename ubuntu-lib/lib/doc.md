# lib 项目结构

所有 `.ts`、`.md` 文件统一使用 UTF-8 with BOM 和 CRLF；新建文件按此写入，修改文件时若编码或换行格式不一致，先转换后修改。

```text
lib/
├── doc.md
├── slices.ts                         # MCP 切片聚合入口
├── Public/                           # 公共内部契约和公共持久化配置
│   ├── Base.ts                       # 基础能力运行契约
│   ├── BaseVite.ts                   # Vite 业务层抽象基类
│   │   ├── abstract protected devPort: z.infer<typeof devPortValidator>
│   │   ├── protected constructor(projectPath: string)
│   │   ├── protected register(): Plugin # configResolved + closeBundle
│   │   ├── protected consume(): Plugin # configResolved
│   │   ├── protected forward(): Plugin # configureServer
│   │   ├── protected route(): Plugin # configureServer/closeBundle
│   │   ├── protected process(): Plugin # closeBundle
│   │   ├── protected processOptions: PM2 启动参数
│   │   ├── devPortValidator: Zod branded validator
│   │   └── protected setVitePort: Plugin["config"]
│   └── store.ts                      # 单服务器公共配置
├── Ssh/                              # 基础切片：SSH 连接和命令执行
│   ├── index.ts
│   │   ├── remoteIsRunning(): Promise<void>
│   │   ├── client: NodeSSH
│   │   ├── state: { host: string; port: number; username: string; password: string }
│   │   ├── revision: number           # SSH 连接版本
│   │   ├── execute(command: string): Promise<SSHExecCommandResponse>
│   │   └── dispose(): void
│   └── store.ts                      # SSH 连接配置
├── Apt/                              # 基础切片：Ubuntu 基础依赖
│   └── index.ts
│       └── remoteIsRunning(): Promise<void>
├── Docker/                           # 基础切片：Docker daemon
│   └── index.ts
│       └── remoteIsRunning(): Promise<void>
├── Sftp/                             # 基础切片：按开发端口建立远程应用目录
│   ├── index.ts
│   │   ├── Remote = { path: string; hasRemote(): Promise<boolean> }
│   │   ├── makeRemote(input: { port: number; localPath: string }): Promise<Remote>
│   │   ├── hasRemote(port: number): Promise<boolean>
│   │   └── getRemote(port: number): Promise<Remote>
│   └── store.ts                      # SFTP 根目录配置
├── SshForward/                       # 基础切片：按开发端口建立 SSH 内网穿透
│   ├── index.ts
│   │   ├── Remote = {
│   │   │   host: string; remotePort: number;
│   │   │   hasRemote(): Promise<boolean>; close(): Promise<void>
│   │   │   }
│   │   ├── makeRemote(port: number): Promise<Remote>
│   │   ├── getRemote(port: number): Promise<Remote>
│   │   ├── hasRemote(port: number): Promise<boolean>
│   │   ├── closeRemote(port: number): Promise<void>
│   │   └── dispose(): Promise<void>
├── Nginx/                            # 基础切片：提供公网入口、子域名和路由
│   └── index.ts
│       ├── Remote = {
│       │   subdomain: string;
│       │   hasRemote(): Promise<boolean>; close(): Promise<void>
│       │   }
│       ├── makeRemote(port: number): Promise<Remote>
│       ├── hasRemote(port: number): Promise<boolean>
│       ├── getRemote(port: number): Promise<Remote>
│       └── closeRemote(port: number): Promise<void>
├── Nodejs/                           # 基础切片：远程 Node.js 运行环境
│   └── index.ts
│       └── remoteIsRunning(): Promise<void>
├── Pm2/                              # 基础切片：按开发端口管理远程进程
│   ├── index.ts
│   │   ├── Remote = {
│   │   │   name: string; path: string;
│   │   │   hasRemote(): Promise<boolean>;
│   │   │   refresh(): Promise<"missing" | "stopped" | "running">;
│   │   │   stop(): Promise<void>; restart(): Promise<void>; close(): Promise<void>
│   │   │   }
│   │   ├── makeRemote(input: { port: number; command: string; environment?: Record<string, string> }): Promise<Remote>
│   │   ├── hasRemote(port: number): Promise<boolean>
│   │   ├── getRemote(port: number): Promise<Remote>
│   │   ├── closeRemote(port: number): Promise<void>
│   │   ├── refresh(port: number): Promise<"missing" | "stopped" | "running">
│   │   ├── stop(port: number): Promise<void>
│   │   └── restart(port: number): Promise<void>
├── Peerjs/                           # 基础切片：固定 PeerJS 公共服务
│   ├── index.ts
│   │   ├── remoteIsRunning(): Promise<void>
│   │   └── state: { host: string; port: 443; path: string; secure: true; key: string }
│   └── store.ts                      # PeerJS 固定配置
├── StunServer/                       # 基础切片：固定 STUN 公共服务
│   ├── index.ts
│   │   ├── remoteIsRunning(): Promise<void>
│   │   ├── state: { host: string; port: number; secure: false }
│   │   └── vitePlugin()
│   └── store.ts                      # STUN 固定配置
└── store/                            # 持久化状态组合，不提供业务能力
    ├── index.ts
    └── type.ts
```

所有切片保持同一级目录和相同的入口风格。

BaseVite 是供具体 Vite 项目继承的组合基类，不是对外提供资源的基础切片。
具体能力方法无参数并直接返回完整 `Plugin`；每个方法内部决定应使用的 Vite 生命周期。
`forward()` 只使用 `configureServer`，`register()` 和 `process()` 只使用 `closeBundle`，`route()` 根据 `config.command` 在对应生命周期执行。
调用方只组合需要的具体能力插件，不传入阶段、端口或远程资源参数；所有资源判断都使用当前开发端口。
`consume()` 在 `configResolved` 中使用 `hasRemote()` 检查当前开发端口对应的远程目录；`getRemote()` 只在需要取得资源对象时使用。
PM2 命令和环境变量集中在子类的 `processOptions` 中。
开发端口由 `devPortValidator` 在输入边界校验，并由 Zod branded schema 保留已校验类型。
唯一闭环主键是开发端口号，不建立 `Map<开发端口, 远程端口>`，也不做远程端口推导。
开发端口是 5000 时，SSH 远程监听端口、Nginx 上游端口和 PM2 服务端口都直接是 5000，
SFTP 目录是该端口对应的目录。

服务器端口资源归具体能力切片管理：SshForward 管理内网穿透端口，Pm2 管理应用服务端口，
Nginx 只使用已分配端口提供公网入口，Sftp 管理应用远程目录。
同一个开发端口不能同时被 SshForward 和 Pm2 占用，PM2 创建进程前必须确认对应 SFTP 目录已经分配。

本地持久化只保存单服务器配置，不能代替远程状态检查。
Sftp 的远程目录标记和 Nginx 的远程配置文件是实际远程资源；
SshForward 和 Pm2 都不持久化动态运行状态。
SshForward 的 `hasRemote()` 检查当前转发句柄及远程监听，
Pm2 的 `hasRemote()` 同时检查远程进程和 SFTP 目录，`refresh()` 检查远程进程状态。
运行时操作锁不能作为资源占用依据。

按开发端口闭环的 `port` 参数均为 1-9999 范围内的开发端口主键；
只有 PM2 启动命令和环境变量不能推导，因此由 `makeRemote` 显式提供。
`remoteIsRunning()` 是切片间内部协作方法；MCP 只注册各切片明确提供的公开能力，业务切片尚未实现。

每个 `makeRemote...` 只在所属切片内分配资源。
同一切片的 `makeRemote...` 与 `getRemote...` 返回相同形态的资源对象，
对象包含真实资源数据以及该资源可用的控制方法。
`getRemote...` 必须先调用切片内的 `hasRemote()`，远程资源不存在或检查失败时抛出错误。
`hasRemote()` 单独返回布尔值；公开 `hasRemote()` 的切片必须同时提供 `getRemote...`。
跨切片调用不得通过其他切片的分配方法回环。

建立 Nginx 路由前，Nginx 必须确认当前开发端口已有可用的 SshForward 或 PM2 服务，
并直接使用同一个开发端口作为上游端口。
`getRemote...` 只接受开发端口主键；凡是返回远程资源描述，都必须异步检查对应远程资源后再返回，
不得调用 `makeRemote...` 或其他切片的分配方法。

SshForward 的 `makeRemote(devPort)` 与 `getRemote(devPort)` 都返回真实 SSH 转发句柄和控制方法；
远程端口由固定申请的开发端口确定，不建立额外映射，也不重复做句柄端口比较。
Nginx 的资源对象只返回实际子域名，不把作为内部上游实现细节的开发端口重复放入返回值。
纯本地派生值使用切片内私有同步方法，不冒充远程资源读取。

PM2、SshForward 和 STUN 建立端口服务前都检查远程实际监听，并避开 80、443 和 SSH 固定端口。
新实现不建立总的 `index.ts`。
