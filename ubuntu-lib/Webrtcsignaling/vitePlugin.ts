import {
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
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
  { entry, jwtSecret }: { entry: string; jwtSecret: string },
) {
  if (!entry.trim()) throw new TypeError("WebRTC 信令入口不能为空");
  if (!jwtSecret.trim()) throw new TypeError("WebRTC 信令 JWT secret 不能为空");

  const signalingServer = runtime.state;
  const { ssh, stunServer } = store.getState();
  if (!Number.isInteger(stunServer.port) || stunServer.port < 1 || stunServer.port > 65_535) {
    throw new RangeError(`STUN 端口必须是 1-65535 的整数: ${String(stunServer.port)}`);
  }
  const servicePort = signalingServer.port + 1;
  if (servicePort > 65_535) throw new RangeError("WebRTC 信令开发服务端口超出范围");

  const host = "127.0.0.1";
  const environment = {
    WS_NO_BUFFER_UTIL: "1",
    WS_NO_UTF_8_VALIDATE: "1",
    WEBRTC_RTC_CONFIGURATION: JSON.stringify({
      iceServers: [{ urls: `stun:${ssh.host}:${stunServer.port}` }],
    }),
    WEBRTC_SIGNALING_HOSTNAME: host,
    WEBRTC_SIGNALING_JWT_SECRET: jwtSecret,
    WEBRTC_SIGNALING_PATH: signalingServer.path,
    WEBRTC_SIGNALING_PORT: String(signalingServer.port),
    WEBRTC_SIGNALING_TOKEN_TTL_SECONDS: "300",
  };
  let projectRoot = process.cwd();
  let artifactPath: string | undefined;
  let isBuild = false;

  return {
    name: "ubuntu-lib:webrtcsignaling",
    config: (_config: unknown, configEnvironment: { command: string }) => (
      configEnvironment.command === "serve"
        ? {
            appType: "custom" as const,
            server: {
              host,
              port: signalingServer.port,
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
              emptyOutDir: true,
              outDir: "dist/webrtcsignaling",
              rollupOptions: {
                output: {
                  entryFileNames: "index.js",
                  format: "es" as const,
                },
              },
              ssr: entry,
              target: "node20",
            },
            ssr: {
              noExternal: true as const,
            },
          }
    ),
    configResolved: (config: { root: string; command: string }) => {
      projectRoot = config.root;
      isBuild = config.command === "build";
      const entryPath = resolve(projectRoot, entry);
      if (!existsSync(entryPath)) throw new Error(`WebRTC 信令入口不存在: ${entryPath}`);
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
    writeBundle: (
      output: { dir?: string; file?: string },
      bundle: Record<string, {
        type: string;
        fileName: string;
        isEntry?: boolean;
      }>,
    ) => {
      const entries = Object.values(bundle).filter(
        item => item.type === "chunk" && item.isEntry,
      );
      if (entries.length !== 1) {
        throw new Error(`WebRTC 信令构建必须产生唯一入口，当前为 ${entries.length} 个`);
      }
      const outputDirectory = output.dir
        ? resolve(projectRoot, output.dir)
        : output.file
          ? dirname(resolve(projectRoot, output.file))
          : undefined;
      if (!outputDirectory) throw new Error("WebRTC 信令构建未提供输出目录");
      artifactPath = resolve(outputDirectory, entries[0].fileName);
    },
    closeBundle: async () => {
      if (!isBuild) return;
      if (!artifactPath) throw new Error("WebRTC 信令构建未产生可报备的入口文件");
      store.getState().webrtcsignalingActions.register({
        path: artifactPath,
        jwtSecret,
      });
      await runtime.isRemoteRunning();
    },
  };
}
