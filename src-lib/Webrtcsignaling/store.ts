import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import {
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import {
  isAbsolute,
  posix,
  relative,
  resolve,
} from "node:path";
import type { SSHExecCommandResponse } from "node-ssh";
import type { Plugin, ViteDevServer } from "vite";

type WebrtcsignalingSlice = {
  Webrtcsignaling: {
    entry: string;
    path: string;
    listenPort: 9001;
    pathname: "/signal";
  };
  WebrtcsignalingActions: {
    register(registration: { entry: string; path: string }): void;
    isRemoteRunning(): Promise<void>;
    vitePlugin(options: { entry: string } | { projectName: string }): Plugin;
  };
};

type WebrtcsignalingDependencies = {
  Public: {
    domain: string;
    remoteRoot: string;
  };
  NginxActions: {
    proxyRouteIsRunning(route: {
      name: string;
      hostname: string;
      pathname: string;
      upstreamPort: number;
    }): Promise<void>;
  };
  Pm2Actions: {
    isRemoteRunning(): Promise<void>;
  };
  SftpActions: {
    remoteDirectoryUpload(
      localPath: string,
      remotePath: string,
      validate: (localPath: string) => boolean,
    ): Promise<void>;
  };
  SshActions: {
    execute(command: string): Promise<SSHExecCommandResponse>;
  };
};

type DevRuntime = {
  child: ChildProcess;
  exitClose(): void;
};

const runtimeKey = Symbol.for("src-lib/webrtcsignaling/vitePlugin");
const runtimeGlobal = globalThis as unknown as Record<symbol, DevRuntime | undefined>;

const childCloseSync = (child: ChildProcess): void => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid !== undefined) {
    const result = spawnSync(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`taskkill 退出码: ${String(result.status)}`);
    }
    return;
  }
  if (!child.kill()) throw new Error("无法停止信令开发进程");
};

const childClose = (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform === "win32" && child.pid !== undefined) {
    return new Promise((resolveClose, rejectClose) => {
      const taskkill = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
      );
      taskkill.once("error", rejectClose);
      taskkill.once("exit", code => {
        if (code === 0) resolveClose();
        else rejectClose(new Error(`taskkill 退出码: ${String(code)}`));
      });
    });
  }
  return new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("exit", () => resolveClose());
    if (!child.kill()) rejectClose(new Error("无法停止信令开发进程"));
  });
};

const serviceReady = (
  child: ChildProcess,
  host: string,
  port: number,
): Promise<void> => new Promise((resolveReady, rejectReady) => {
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    child.off("error", childError);
    child.off("exit", childExit);
    if (error) rejectReady(error);
    else resolveReady();
  };
  const childError = (error: Error) => finish(error);
  const childExit = (code: number | null, signal: NodeJS.Signals | null) => finish(
    new Error(code === null
      ? `信令开发进程被 ${signal ?? "unknown"} 终止`
      : `信令开发进程退出码: ${String(code)}`),
  );
  const probe = () => {
    if (settled) return;
    const socket = createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      finish();
    });
    socket.once("error", () => {
      socket.destroy();
      setTimeout(probe, 25);
    });
  };
  const timeout = setTimeout(
    () => finish(new Error(`信令开发服务未在十秒内监听 ${host}:${port}`)),
    10_000,
  );
  child.once("error", childError);
  child.once("exit", childExit);
  probe();
});

const runtimeClose = async (
  runtime: DevRuntime,
  server: ViteDevServer,
): Promise<void> => {
  process.off("exit", runtime.exitClose);
  if (runtimeGlobal[runtimeKey] === runtime) runtimeGlobal[runtimeKey] = undefined;
  try {
    await childClose(runtime.child);
  } catch (error) {
    server.config.logger.error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  }
};

const s: immerStateCreator<
  WebrtcsignalingSlice,
  WebrtcsignalingDependencies
> = (set, get) => {
  let running: Promise<void> | undefined;
  const shell = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
  const serviceRead = () => ({
    host: `webrtc.${get().Public.domain.trim().toLowerCase()}`,
    port: 443 as const,
    path: get().Webrtcsignaling.pathname,
    secure: true as const,
  });
  const register = (registration: { entry: string; path: string }): void => {
    if (!isAbsolute(registration.path)) {
      throw new TypeError(`WebRTC 信令源码目录必须是绝对路径: ${registration.path}`);
    }
    if (!/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~/-]+\.tsx?$/.test(registration.entry)) {
      throw new TypeError(`WebRTC 信令 TypeScript 入口无效: ${registration.entry}`);
    }
    set(state => {
      state.Webrtcsignaling.entry = registration.entry;
      state.Webrtcsignaling.path = registration.path;
    });
  };
  const isRemoteRunning = (): Promise<void> => {
    if (running) return running;
    const execution = (async () => {
      const serviceName = "webrtcsignaling";
      const { entry, path, pathname, listenPort } = get().Webrtcsignaling;
      if (!path || !entry) throw new Error("WebRTC 信令外部实现尚未报备源码目录和入口");
      if (!isAbsolute(path) || !existsSync(path) || !lstatSync(path).isDirectory()) {
        throw new Error(`WebRTC 信令源码目录无效: ${path}`);
      }
      if (!/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~/-]+\.tsx?$/.test(entry)) {
        throw new TypeError(`WebRTC 信令 TypeScript 入口无效: ${entry}`);
      }
      const entryPath = resolve(path, entry);
      if (!existsSync(entryPath) || !lstatSync(entryPath).isFile()) {
        throw new Error(`WebRTC 信令 TypeScript 入口不存在: ${entryPath}`);
      }
      const packagePath = resolve(path, "package.json");
      if (!existsSync(packagePath)) {
        throw new Error(`WebRTC 信令 package.json 不存在: ${packagePath}`);
      }
      const sourcePackage = JSON.parse(readFileSync(packagePath, "utf8")) as {
        dependencies?: unknown;
        name?: unknown;
        type?: unknown;
      };
      if (
        !sourcePackage.dependencies
        || typeof sourcePackage.dependencies !== "object"
        || Array.isArray(sourcePackage.dependencies)
      ) {
        throw new TypeError(`WebRTC 信令 dependencies 无效: ${packagePath}`);
      }
      const dependencies: Record<string, string> = {};
      for (const [name, version] of Object.entries(sourcePackage.dependencies)) {
        if (
          !/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name)
          || typeof version !== "string"
          || !version
          || /^(?:workspace|file|link):/.test(version)
        ) {
          throw new TypeError(`WebRTC 信令生产依赖无效: ${name}@${String(version)}`);
        }
        dependencies[name] = version;
      }
      if (typeof dependencies.tsx !== "string") {
        throw new TypeError(`WebRTC 信令必须在 dependencies 声明 tsx: ${packagePath}`);
      }
      const deploymentPackage = `${JSON.stringify({
        name: typeof sourcePackage.name === "string" ? sourcePackage.name : serviceName,
        private: true,
        type: sourcePackage.type === "commonjs" ? "commonjs" : "module",
        dependencies: Object.fromEntries(
          Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right)),
        ),
      }, null, 2)}\n`;
      const remoteRoot = get().Public.remoteRoot;
      if (
        !remoteRoot.startsWith("/")
        || remoteRoot.includes("\0")
        || remoteRoot.includes("\\")
        || posix.normalize(remoteRoot) !== remoteRoot
      ) {
        throw new TypeError(`远端服务根目录必须是 Linux 绝对路径: ${remoteRoot}`);
      }
      const remotePath = posix.join(remoteRoot, serviceName);
      const environment = {
        WS_NO_BUFFER_UTIL: "1",
        WS_NO_UTF_8_VALIDATE: "1",
        WEBRTC_SIGNALING_HOSTNAME: "127.0.0.1",
        WEBRTC_SIGNALING_PATH: pathname,
        WEBRTC_SIGNALING_PORT: String(listenPort),
      };
      const healthCommand =
        `curl --fail --silent http://127.0.0.1:${listenPort}${pathname} | grep '"name":"webrtcsignaling"'`;
      const ignoredNames = new Set([".git", ".src-lib", "dist", "node_modules"]);
      const sourceIncluded = (localPath: string): boolean => {
        const segments = relative(path, localPath).split(/[\\/]/).filter(Boolean);
        return !segments.some(segment => ignoredNames.has(segment))
          && !segments.some(segment => segment === ".env" || segment.startsWith(".env."))
          && !lstatSync(localPath).isSymbolicLink();
      };
      const sourceHash = createHash("sha256");
      const sourceHashUpdate = (directory: string): void => {
        for (const entryState of readdirSync(directory, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name))) {
          const localPath = resolve(directory, entryState.name);
          if (!sourceIncluded(localPath)) continue;
          const sourceName = relative(path, localPath).replace(/\\/g, "/");
          if (entryState.isDirectory()) sourceHashUpdate(localPath);
          if (entryState.isFile()) {
            sourceHash.update(sourceName).update("\0").update(readFileSync(localPath));
          }
        }
      };
      sourceHashUpdate(path);
      const revision = sourceHash
        .update("\0")
        .update(deploymentPackage)
        .update("\0")
        .update(JSON.stringify({ entry, environment, healthCommand }))
        .digest("hex");
      const incoming = `${remotePath}/.incoming-${revision}`;
      const release = `${remotePath}/releases/${revision}`;
      const current = `${remotePath}/current`;
      const next = `${remotePath}/.current-next`;

      await get().Pm2Actions.isRemoteRunning();
      const readiness = await get().SshActions.execute(`
set -e
CURRENT_REVISION="$(cat ${shell(`${current}/.src-service-revision`)} 2>/dev/null || true)"
PID="$(pm2 pid ${shell(serviceName)} 2>/dev/null || true)"
if [ "$CURRENT_REVISION" = ${shell(revision)} ] \
  && [ -n "$PID" ] \
  && [ "$PID" -gt 0 ] 2>/dev/null \
  && (${healthCommand}) >/dev/null 2>&1; then
  printf ready
else
  printf deploy
fi
`);
      if (readiness.stdout.trim() !== "ready") {
        await get().SshActions.execute(`
set -e
mkdir -p ${shell(`${remotePath}/releases`)}
rm -rf ${shell(incoming)}
mkdir -p ${shell(incoming)}
`);
        await get().SftpActions.remoteDirectoryUpload(path, incoming, sourceIncluded);
        const environmentCommand = Object.entries(environment)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, value]) => `${name}=${shell(value)}`)
          .join(" ");
        const start = [
          "#!/usr/bin/env bash",
          "set -e",
          'cd -- "$(dirname -- "$0")"',
          `exec env ${environmentCommand} ./node_modules/.bin/tsx ${shell(entry)}`,
          "",
        ].join("\n");
        await get().SshActions.execute(`
set -e
if [ -d ${shell(release)} ]; then
  rm -rf ${shell(incoming)}
else
  cd ${shell(incoming)}
  test -f ${shell(entry)}
  printf %s ${shell(deploymentPackage)} > package.json
  npm install --omit=dev --no-package-lock
  printf %s ${shell(revision)} > .src-service-revision
  printf %s ${shell(start)} > .src-service-start
  chmod 700 .src-service-start
  mv ${shell(incoming)} ${shell(release)}
fi
`);
        await get().SshActions.execute(`
set -e
PREVIOUS="$(readlink -f ${shell(current)} 2>/dev/null || true)"
rollback() {
  STATUS=$?
  trap - ERR
  pm2 delete ${shell(serviceName)} >/dev/null 2>&1 || true
  if [ -n "$PREVIOUS" ] && [ -f "$PREVIOUS/.src-service-start" ]; then
    ln -sfn "$PREVIOUS" ${shell(next)}
    mv -Tf ${shell(next)} ${shell(current)}
    cd ${shell(current)}
    pm2 start ./.src-service-start --name ${shell(serviceName)} --interpreter bash >/dev/null
  else
    rm -f ${shell(current)} ${shell(next)}
  fi
  pm2 save --force >/dev/null 2>&1 || true
  exit "$STATUS"
}
trap rollback ERR
ln -sfn ${shell(release)} ${shell(next)}
mv -Tf ${shell(next)} ${shell(current)}
pm2 delete ${shell(serviceName)} >/dev/null 2>&1 || true
cd ${shell(current)}
pm2 start ./.src-service-start --name ${shell(serviceName)} --interpreter bash >/dev/null
pm2 save --force >/dev/null
HEALTHY=0
for attempt in $(seq 1 40); do
  if (${healthCommand}) >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 0.25
done
test "$HEALTHY" = 1
trap - ERR
`);
      }
      const state = serviceRead();
      await get().NginxActions.proxyRouteIsRunning({
        name: serviceName,
        hostname: state.host,
        pathname: state.path,
        upstreamPort: listenPort,
      });
      const health = await fetch(`https://${state.host}${state.path}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const healthState = await health.json() as { name?: unknown };
      if (!health.ok || healthState.name !== serviceName) {
        throw new Error(`WebRTC 信令公网健康检查失败: HTTP ${health.status}`);
      }
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const socket = new WebSocket(`wss://${state.host}${state.path}/src-lib-health`);
        const timeout = setTimeout(() => {
          socket.close();
          rejectPromise(new Error("WebRTC 信令公网 WebSocket 握手超时"));
        }, 5_000);
        socket.addEventListener("message", event => {
          try {
            const message = JSON.parse(String(event.data)) as {
              type?: unknown;
              peerId?: unknown;
              projectName?: unknown;
            };
            if (
              message.type !== "open"
              || typeof message.peerId !== "string"
              || message.projectName !== "src-lib-health"
            ) return;
            clearTimeout(timeout);
            socket.close();
            resolvePromise();
          } catch (error) {
            clearTimeout(timeout);
            socket.close();
            rejectPromise(error);
          }
        });
        socket.addEventListener("error", () => {
          clearTimeout(timeout);
          socket.close();
          rejectPromise(new Error("WebRTC 信令公网 WebSocket 握手失败"));
        });
      });
    })().finally(() => {
      if (running === execution) running = undefined;
    });
    running = execution;
    return execution;
  };

  return {
    Webrtcsignaling: {
      entry: "",
      path: "",
      listenPort: 9001,
      pathname: "/signal",
    },
    WebrtcsignalingActions: {
      register,
      isRemoteRunning,
      vitePlugin(options) {
        const signaling = serviceRead();
        if ("projectName" in options) {
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.projectName)) {
            throw new TypeError(`WebRTC 项目名称无效: ${options.projectName}`);
          }
          return {
            name: "src-lib:webrtcsignaling-consumer",
            config: () => ({
              define: {
                "globalThis.WEBRTC_PROJECT_NAME": JSON.stringify(options.projectName),
                "globalThis.WEBRTC_SIGNALING_URL": JSON.stringify(
                  `${signaling.secure ? "https" : "http"}://${signaling.host}${signaling.path}`,
                ),
              },
            }),
          };
        }
        const entry = options.entry.trim();
        if (!entry) throw new TypeError("WebRTC 信令入口不能为空");
        const { listenPort, pathname } = get().Webrtcsignaling;
        const servicePort = listenPort + 1;
        if (servicePort > 65_535) {
          throw new RangeError("WebRTC 信令开发服务端口超出范围");
        }
        const host = "127.0.0.1";
        const environment = {
          WS_NO_BUFFER_UTIL: "1",
          WS_NO_UTF_8_VALIDATE: "1",
          WEBRTC_SIGNALING_HOSTNAME: host,
          WEBRTC_SIGNALING_PATH: pathname,
          WEBRTC_SIGNALING_PORT: String(listenPort),
        };
        let projectRoot = process.cwd();
        let sourceEntry = "";
        let build = false;
        return {
          name: "src-lib:webrtcsignaling",
          config: (_config, configEnvironment) => configEnvironment.command === "serve"
            ? {
                appType: "custom" as const,
                server: {
                  host,
                  port: listenPort,
                  proxy: {
                    "^/(?!__vite_ping)": {
                      target: `http://${host}:${servicePort}`,
                      ws: true,
                    },
                  },
                  strictPort: true,
                },
              }
            : {
                build: {
                  ssr: entry,
                  target: "node20",
                  write: false,
                },
              },
          configResolved(config) {
            projectRoot = config.root;
            build = config.command === "build";
            const entryPath = resolve(projectRoot, entry);
            if (!existsSync(entryPath)) {
              throw new Error(`WebRTC 信令入口不存在: ${entryPath}`);
            }
            sourceEntry = relative(projectRoot, entryPath).replace(/\\/g, "/");
            if (!sourceEntry || sourceEntry.startsWith("../")) {
              throw new Error(`WebRTC 信令入口必须位于项目根目录内: ${entryPath}`);
            }
          },
          async configureServer(server) {
            const previous = runtimeGlobal[runtimeKey];
            if (previous) await runtimeClose(previous, server);
            const child = spawn(
              process.execPath,
              [
                createRequire(resolve(projectRoot, "package.json")).resolve("tsx/cli"),
                "watch",
                resolve(projectRoot, entry),
              ],
              {
                cwd: projectRoot,
                env: {
                  ...process.env,
                  ...environment,
                  HOST: host,
                  PORT: String(servicePort),
                },
                stdio: "inherit",
                windowsHide: true,
              },
            );
            const exitClose = () => childCloseSync(child);
            const runtime = { child, exitClose };
            runtimeGlobal[runtimeKey] = runtime;
            process.once("exit", exitClose);
            try {
              await serviceReady(child, host, servicePort);
            } catch (error) {
              await runtimeClose(runtime, server);
              throw error;
            }
            server.httpServer?.once("close", () => {
              void runtimeClose(runtime, server);
            });
          },
          async closeBundle() {
            if (!build) return;
            if (!sourceEntry) throw new Error("WebRTC 信令源码入口尚未完成校验");
            register({ entry: sourceEntry, path: projectRoot });
            await isRemoteRunning();
          },
        };
      },
    },
  };
};

export default s;
