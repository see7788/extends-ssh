import {
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { relative, resolve } from "node:path";
import store from "../store.ts";

type Runtime = {
  readonly state: {
    host: string;
    port: number;
    path: string;
    secure: boolean;
  };
  isRemoteRunning(): Promise<void>;
};

type SignalingSourceOptions = {
  entry: string;
};

type SignalingConsumerOptions = {
  projectName: string;
};

type VitePluginOptions = SignalingSourceOptions | SignalingConsumerOptions;

type DevServer = {
  config: {
    logger: {
      error(message: string): void;
    };
  };
  httpServer?: {
    once(event: "close", listener: () => void): unknown;
  } | null;
};

type DevRuntime = {
  child: ChildProcess;
  exitClose(): void;
};

const runtimeKey = Symbol.for("ubuntu-lib/webrtcsignaling/vitePlugin");
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
    if (result.status !== 0) throw new Error(`taskkill 退出码: ${String(result.status)}`);
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
  let isSettled = false;
  const finish = (error?: Error) => {
    if (isSettled) return;
    isSettled = true;
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
    if (isSettled) return;
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

const runtimeClose = async (runtime: DevRuntime, server: DevServer): Promise<void> => {
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

export default function vitePlugin(
  runtime: Runtime,
  options: VitePluginOptions,
) {
  const signalingServer = runtime.state;
  if ("projectName" in options) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.projectName)) {
      throw new TypeError(`WebRTC 项目名称无效: ${options.projectName}`);
    }
    return {
      name: "ubuntu-lib:webrtcsignaling-consumer",
      config: () => ({
        define: {
          "globalThis.WEBRTC_PROJECT_NAME": JSON.stringify(options.projectName),
          "globalThis.WEBRTC_SIGNALING_URL": JSON.stringify(
            `${signalingServer.secure ? "https" : "http"}://${signalingServer.host}${signalingServer.path}`,
          ),
        },
      }),
    };
  }

  const { entry } = options;
  if (!entry.trim()) throw new TypeError("WebRTC 信令入口不能为空");

  const { listenPort, pathname } = store.getState().webrtcsignaling;
  const servicePort = listenPort + 1;
  if (servicePort > 65_535) throw new RangeError("WebRTC 信令开发服务端口超出范围");

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
  let isBuild = false;

  return {
    name: "ubuntu-lib:webrtcsignaling",
    config: (_config: unknown, configEnvironment: { command: string }) => (
      configEnvironment.command === "serve"
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
          }
    ),
    configResolved: (config: { root: string; command: string }) => {
      projectRoot = config.root;
      isBuild = config.command === "build";
      const entryPath = resolve(projectRoot, entry);
      if (!existsSync(entryPath)) throw new Error(`WebRTC 信令入口不存在: ${entryPath}`);
      sourceEntry = relative(projectRoot, entryPath).replaceAll("\\", "/");
      if (!sourceEntry || sourceEntry.startsWith("../")) {
        throw new Error(`WebRTC 信令入口必须位于项目根目录内: ${entryPath}`);
      }
    },
    configureServer: async (server: DevServer) => {
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
      const devRuntime = { child, exitClose };
      runtimeGlobal[runtimeKey] = devRuntime;
      process.once("exit", exitClose);
      try {
        await serviceReady(child, host, servicePort);
      } catch (error) {
        await runtimeClose(devRuntime, server);
        throw error;
      }
      server.httpServer?.once("close", () => {
        void runtimeClose(devRuntime, server);
      });
    },
    closeBundle: async () => {
      if (!isBuild) return;
      if (!sourceEntry) throw new Error("WebRTC 信令源码入口尚未完成校验");
      store.getState().webrtcsignalingActions.register({
        entry: sourceEntry,
        path: projectRoot,
      });
      await runtime.isRemoteRunning();
    },
  };
}
