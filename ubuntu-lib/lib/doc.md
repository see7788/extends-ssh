# lib 项目结构

lib/
├── public/
│   ├── Base.ts<Base<T>>
│   │   └── abstract readonly current: T;
│   ├── ServerBase.ts<ServerBase>
│   │   ├── constructor(devPort: number);
│   │   ├── readonly plugin: Plugin[];
│   │   ├── addPm2(input: Pm2Input): this;
│   │   ├── addSftp(): this;
│   │   ├── addSshForward(): this;
│   │   ├── addNginxPort(): this;
│   │   ├── addNginxPath(): this;
│   │   ├── addPeerjs(): this;
│   │   └── addStunServer(): this;
│   └── store.ts<ImmerStateCreator<{ domain: string }>>
├── apt/
│   └── index.ts<Base<Current>>
│       ├── type Current = () => Promise<void>;
│       └── readonly current: Current;
├── certificate/
│   ├── index.ts<Base<(hostname: string) => Promise<Current>>>
│   │   ├── type Current = {
│   │   │   ├── readonly certPath: string;
│   │   │   ├── readonly keyPath: string;
│   │   │   └── };
│   │   ├── readonly current: (hostname: string) => Promise<Current>;
│   │   └── ensure(hostname: string): Promise<Current>;
│   └── store.ts<ImmerStateCreator<{ certificate: { root: string } }>>
├── docker/
│   └── index.ts<Base<Current>>
│       ├── type Current = () => Promise<void>;
│       └── readonly current: Current;
├── localShell/
│   └── store.ts<ImmerStateCreator<{ localShellActions: { hasPort(port: number): Promise<boolean> } }>>
├── nginx/
│   └── index.ts<Base<(input: number | string) => Promise<Current>>>
│       ├── type Current = {
│       │   ├── readonly subdomain: string;
│       │   ├── hasRemote(): Promise<boolean>;
│       │   ├── close(): Promise<void>;
│       │   └── };
│       ├── readonly current: (input: number | string) => Promise<Current>;
│       ├── getRemote(port: number): Promise<Current>;
│       ├── hasRemote(port: number): Promise<boolean>;
│       ├── makeRemote(input: number | string): Promise<Current>;
│       └── closeRemote(port: number): Promise<void>;
├── nodejs/
│   └── index.ts<Base<Current>>
│       ├── type Current = () => Promise<void>;
│       └── readonly current: Current;
├── peerjs/
│   ├── index.ts<Base<() => Promise<Current>>>
│   │   ├── type Current = {
│   │   │   ├── readonly host: string;
│   │   │   ├── readonly port: number;
│   │   │   ├── readonly path: string;
│   │   │   ├── readonly secure: false;
│   │   │   ├── readonly key: string;
│   │   │   └── };
│   │   └── readonly current: () => Promise<Current>;
│   └── store.ts<ImmerStateCreator<{ peerjs: { image: "peerjs/peerjs-server:1.0.2"; key: "peerjs"; listenPort: 9000; pathname: "/peerjs" } }>>
├── pm2/
│   └── index.ts<Base<(input: Pm2Input) => Promise<Current>>>
│       ├── type Pm2Input = {
│       │   ├── port: number;
│       │   ├── path: string;
│       │   ├── command: string;
│       │   ├── environment?: Record<string, string>;
│       │   └── };
│       ├── type Current = {
│       │   ├── readonly name: string;
│       │   ├── hasRemote(): Promise<boolean>;
│       │   ├── refresh(): Promise<"missing" | "stopped" | "running">;
│       │   ├── stop(): Promise<void>;
│       │   ├── restart(): Promise<void>;
│       │   ├── close(): Promise<void>;
│       │   └── };
│       ├── readonly current: (input: Pm2Input) => Promise<Current>;
│       ├── getRemote(port: number): Promise<Current>;
│       ├── makeRemote(input: Pm2Input): Promise<Current>;
│       ├── refresh(port: number): Promise<"missing" | "stopped" | "running">;
│       ├── hasRemote(port: number): Promise<boolean>;
│       ├── stop(port: number): Promise<void>;
│       ├── restart(port: number): Promise<void>;
│       └── closeRemote(port: number): Promise<void>;
├── sftp/
│   ├── index.ts<Base<(input: SftpInput) => Promise<Current>>>
│   │   ├── type SftpInput = {
│   │   │   ├── port: number;
│   │   │   ├── localPath: string;
│   │   │   └── };
│   │   ├── type Current = {
│   │   │   ├── readonly path: string;
│   │   │   ├── hasRemote(): Promise<boolean>;
│   │   │   └── };
│   │   ├── readonly current: (input: SftpInput) => Promise<Current>;
│   │   ├── getRemote(port: number): Promise<Current>;
│   │   ├── hasRemote(port: number): Promise<boolean>;
│   │   └── makeRemote(input: SftpInput): Promise<Current>;
│   └── store.ts<ImmerStateCreator<{ sftp: { remoteRoot: string } }>>
├── ssh/
│   ├── index.ts<Base<() => Promise<Current>>>
│   │   ├── type PortListener = {
│   │   │   ├── protocol: "tcp" | "udp";
│   │   │   ├── address: string;
│   │   │   ├── port: number;
│   │   │   ├── pid?: number;
│   │   │   ├── process?: string;
│   │   │   ├── project?: string;
│   │   │   ├── path?: string;
│   │   │   └── };
│   │   ├── type PortState = {
│   │   │   ├── occupied: boolean;
│   │   │   ├── listeners: PortListener[];
│   │   │   └── };
│   │   ├── type Current = {
│   │   │   ├── readonly client: NodeSSH;
│   │   │   ├── execute(command: string): Promise<SSHExecCommandResponse>;
│   │   │   ├── hasPort(port: number): Promise<PortState>;
│   │   │   ├── dispose(): void;
│   │   │   └── };
│   │   ├── readonly current: () => Promise<Current>;
│   │   ├── execute(command: string): Promise<SSHExecCommandResponse>;
│   │   ├── hasPort(port: number): Promise<PortState>;
│   │   └── dispose(): void;
│   └── store.ts<ImmerStateCreator<{ ssh: { host: string; port: number; username: string; password: string } }>>
├── sshForward/
│   └── index.ts<Base<(port: number) => Promise<Current>>>
│       ├── type Current = {
│       │   ├── readonly remotePort: number;
│       │   ├── hasRemote(): Promise<boolean>;
│       │   ├── close(): Promise<void>;
│       │   └── };
│       ├── readonly current: (port: number) => Promise<Current>;
│       ├── makeRemote(port: number): Promise<Current>;
│       ├── getRemote(port: number): Promise<Current>;
│       ├── hasRemote(port: number): Promise<boolean>;
│       ├── closeRemote(port: number): Promise<void>;
│       └── dispose(): Promise<void>;
├── stunServer/
│   ├── index.ts<Base<() => Promise<Current>>>
│   │   ├── type Current = {
│   │   │   ├── readonly host: string;
│   │   │   ├── readonly port: number;
│   │   │   ├── readonly secure: false;
│   │   │   └── };
│   │   └── readonly current: () => Promise<Current>;
│   └── store.ts<ImmerStateCreator<{ stunServer: { port: number } }>>
└── store/
    ├── index.ts<Store>
    └── type.ts
        └── Store;
