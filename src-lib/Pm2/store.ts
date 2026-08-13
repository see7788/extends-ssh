import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import type { SSHExecCommandResponse } from "node-ssh";

type Pm2Slice = {
  pm2Actions: {
    isRemoteRunning(): Promise<void>;
    processIsRemoteRunning(process: {
      name: string;
      path: string;
      command: string;
      port: number;
      environment?: Record<string, string>;
    }): Promise<void>;
    processRemoteClose(name: string): Promise<void>;
  };
};

type Pm2Dependencies = {
  nodejsActions: {
    isRemoteRunning(): Promise<void>;
  };
  sshActions: {
    execute(command: string): Promise<SSHExecCommandResponse>;
  };
};

const s: immerStateCreator<Pm2Slice, Pm2Dependencies> = (_set, get) => {
  let running: Promise<void> | undefined;
  const shell = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
  const nameRequired = (name: string): string => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
      throw new TypeError(`PM2 进程名称无效: ${name}`);
    }
    return name;
  };
  return {
    pm2Actions: {
      isRemoteRunning() {
        if (running) return running;
        const execution = (async () => {
          await get().nodejsActions.isRemoteRunning();
          await get().sshActions.execute(`
set -e
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
PM2="$(command -v pm2)"
test -x "$PM2"
if [ "$PM2" != /usr/local/bin/pm2 ]; then
  ln -sfn "$PM2" /usr/local/bin/pm2
fi
pm2 ping >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null
pm2 save --force >/dev/null
systemctl enable pm2-root >/dev/null
systemctl is-enabled --quiet pm2-root
pm2 --version >/dev/null
`);
        })().finally(() => {
          if (running === execution) running = undefined;
        });
        running = execution;
        return execution;
      },
      async processIsRemoteRunning(process) {
        await get().pm2Actions.isRemoteRunning();
        const name = nameRequired(process.name);
        if (!Number.isInteger(process.port) || process.port < 1 || process.port > 65_535) {
          throw new TypeError(`PM2 进程端口无效: ${String(process.port)}`);
        }
        const environment = Object.entries(process.environment ?? {})
          .map(([key, value]) => {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
              throw new TypeError(`PM2 环境变量名称无效: ${key}`);
            }
            return `${key}=${shell(value)}`;
          })
          .join(" ");
        await get().sshActions.execute(`
set -e
pm2 delete ${shell(name)} >/dev/null 2>&1 || true
cd ${shell(process.path)}
${environment} pm2 start bash --name ${shell(name)} -- -lc ${shell(process.command)}
pm2 save --force >/dev/null
for attempt in $(seq 1 20); do
  ROOT_PID=$(pm2 pid ${shell(name)})
  if [ -n "$ROOT_PID" ] && [ "$ROOT_PID" != 0 ]; then
    PIDS="$ROOT_PID"
    CURRENT="$ROOT_PID"
    while [ -n "$CURRENT" ]; do
      CHILDREN=""
      for PID in $CURRENT; do CHILDREN="$CHILDREN $(pgrep -P "$PID" 2>/dev/null || true)"; done
      PIDS="$PIDS $CHILDREN"
      CURRENT="$CHILDREN"
    done
    for PID in $PIDS; do
      if lsof -Pan -p "$PID" -iTCP:${process.port} -sTCP:LISTEN >/dev/null 2>&1; then exit 0; fi
    done
  fi
  sleep 0.5
done
pm2 logs ${shell(name)} --lines 40 --nostream >&2 || true
echo ${shell(`PM2 进程未监听端口 ${process.port}: ${name}`)} >&2
exit 1
`);
      },
      async processRemoteClose(name) {
        await get().sshActions.execute(`
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete ${shell(nameRequired(name))} >/dev/null 2>&1 || true
  pm2 save --force >/dev/null 2>&1 || true
fi
`);
      },
    },
  };
};

export default s;
