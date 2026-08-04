# extends-ssh

`extends-ssh` 只作为 pnpm workspace 容器，分别维护旧版 SSH 生产者 `src-lib` 与新版
Ubuntu 服务生产者 `ubuntu-lib`；在容器根执行 `pnpm install` 后按 package 名消费或验证。

## Tree

```text
extends-ssh/
├── pnpm-workspace.yaml
├── src-lib/
│   ├── package.json
│   ├── Ubuntu.ts
│   ├── store.ts
│   └── README.md
└── ubuntu-lib/
    ├── package.json
    ├── index.ts
    ├── store.ts
    ├── public.ts
    ├── Pm2.ts
    ├── Vite/
    ├── WebrtcProxy/
    └── README.md
```

## 核心使用

```powershell
pnpm --filter src-lib typecheck
pnpm --filter ubuntu-lib typecheck
```
