import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import {
  isAbsolute,
  posix,
  relative,
  resolve,
} from "node:path";
import type Nginx from "../Nginx/index.ts";
import type Pm2 from "../Pm2/index.ts";
import type Sftp from "../Sftp/index.ts";
import type Ssh from "../Ssh/index.ts";
import store from "../store.ts";
import vitePlugin from "./vitePlugin.ts";

export default abstract class Webrtcsignaling {
  protected abstract readonly nginx: Nginx;
  protected abstract readonly pm2: Pm2;
  protected abstract readonly sftp: Sftp;
  protected abstract readonly ssh: Ssh;
  private remoteRunningPromise?: Promise<void>;

  public get state() {
    const { public: publicState, webrtcsignaling } = store.getState();
    const domain = publicState.domain.trim().toLowerCase();
    return {
      host: `webrtc.${domain}`,
      port: 443 as const,
      path: webrtcsignaling.pathname,
      secure: true as const,
    };
  }

  public isRemoteRunning(): Promise<void> {
    if (this.remoteRunningPromise) return this.remoteRunningPromise;
    const remoteRunningPromise = this.remoteRunningEnsure().finally(() => {
      if (this.remoteRunningPromise === remoteRunningPromise) {
        this.remoteRunningPromise = undefined;
      }
    });
    this.remoteRunningPromise = remoteRunningPromise;
    return remoteRunningPromise;
  }

  public vitePlugin(options: { entry: string } | { projectName: string }) {
    return vitePlugin(this, options);
  }

  private async remoteRunningEnsure(): Promise<void> {
    const serviceName = "webrtcsignaling";
    const { entry, path, pathname, listenPort } = store.getState().webrtcsignaling;
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
    if (!existsSync(packagePath)) throw new Error(`WebRTC 信令 package.json 不存在: ${packagePath}`);
    const sourcePackage = JSON.parse(readFileSync(packagePath, "utf8")) as {
      dependencies?: unknown;
      name?: unknown;
      type?: unknown;
    };
    if (
      !sourcePackage.dependencies
      || typeof sourcePackage.dependencies !== "object"
      || Array.isArray(sourcePackage.dependencies)
    ) throw new TypeError(`WebRTC 信令 dependencies 无效: ${packagePath}`);
    const dependencies: Record<string, string> = {};
    for (const [name, version] of Object.entries(sourcePackage.dependencies)) {
      if (
        !/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name)
        || typeof version !== "string"
        || !version
        || /^(?:workspace|file|link):/.test(version)
      ) throw new TypeError(`WebRTC 信令生产依赖无效: ${name}@${String(version)}`);
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

    const remoteRoot = store.getState().public.remoteRoot;
    if (
      !remoteRoot.startsWith("/")
      || remoteRoot.includes("\0")
      || remoteRoot.includes("\\")
      || posix.normalize(remoteRoot) !== remoteRoot
    ) throw new TypeError(`远端服务根目录必须是 Linux 绝对路径: ${remoteRoot}`);
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
    const ignoredNames = new Set([".git", ".ubuntu-lib", "dist", "node_modules"]);
    const sourceIncluded = (localPath: string): boolean => {
      const segments = relative(path, localPath).split(/[\\/]/).filter(Boolean);
      return !segments.some(segment => ignoredNames.has(segment))
        && !segments.some(segment => segment === ".env" || segment.startsWith(".env."))
        && !lstatSync(localPath).isSymbolicLink();
    };
    const sourceHash = createHash("sha256");
    const sourceHashUpdate = (directory: string): void => {
      for (const directoryEntry of readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const localPath = resolve(directory, directoryEntry.name);
        if (!sourceIncluded(localPath)) continue;
        const sourceName = relative(path, localPath).replaceAll("\\", "/");
        if (directoryEntry.isDirectory()) sourceHashUpdate(localPath);
        if (directoryEntry.isFile()) {
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

    await this.pm2.isRemoteRunning();
    const readiness = await this.ssh.execute(`
set -e
CURRENT_REVISION="$(cat ${this.shell(`${current}/.ubuntu-service-revision`)} 2>/dev/null || true)"
PID="$(pm2 pid ${this.shell(serviceName)} 2>/dev/null || true)"
if [ "$CURRENT_REVISION" = ${this.shell(revision)} ] \
  && [ -n "$PID" ] \
  && [ "$PID" -gt 0 ] 2>/dev/null \
  && (${healthCommand}) >/dev/null 2>&1; then
  printf ready
else
  printf deploy
fi
`);
    if (readiness.stdout.trim() !== "ready") {
      await this.ssh.execute(`
set -e
mkdir -p ${this.shell(`${remotePath}/releases`)}
rm -rf ${this.shell(incoming)}
mkdir -p ${this.shell(incoming)}
`);
      await this.sftp.remoteDirectoryUpload(path, incoming, sourceIncluded);

      const environmentCommand = Object.entries(environment)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}=${this.shell(value)}`)
        .join(" ");
      const start = [
        "#!/usr/bin/env bash",
        "set -e",
        'cd -- "$(dirname -- "$0")"',
        `exec env ${environmentCommand} ./node_modules/.bin/tsx ${this.shell(entry)}`,
        "",
      ].join("\n");
      await this.ssh.execute(`
set -e
if [ -d ${this.shell(release)} ]; then
  rm -rf ${this.shell(incoming)}
else
  cd ${this.shell(incoming)}
  test -f ${this.shell(entry)}
  printf %s ${this.shell(deploymentPackage)} > package.json
  npm install --omit=dev --no-package-lock
  printf %s ${this.shell(revision)} > .ubuntu-service-revision
  printf %s ${this.shell(start)} > .ubuntu-service-start
  chmod 700 .ubuntu-service-start
  mv ${this.shell(incoming)} ${this.shell(release)}
fi
`);
      await this.ssh.execute(`
set -e
PREVIOUS="$(readlink -f ${this.shell(current)} 2>/dev/null || true)"
rollback() {
  STATUS=$?
  trap - ERR
  pm2 delete ${this.shell(serviceName)} >/dev/null 2>&1 || true
  if [ -n "$PREVIOUS" ] && [ -f "$PREVIOUS/.ubuntu-service-start" ]; then
    ln -sfn "$PREVIOUS" ${this.shell(next)}
    mv -Tf ${this.shell(next)} ${this.shell(current)}
    cd ${this.shell(current)}
    pm2 start ./.ubuntu-service-start --name ${this.shell(serviceName)} --interpreter bash >/dev/null
  else
    rm -f ${this.shell(current)} ${this.shell(next)}
  fi
  pm2 save --force >/dev/null 2>&1 || true
  exit "$STATUS"
}
trap rollback ERR
ln -sfn ${this.shell(release)} ${this.shell(next)}
mv -Tf ${this.shell(next)} ${this.shell(current)}
pm2 delete ${this.shell(serviceName)} >/dev/null 2>&1 || true
cd ${this.shell(current)}
pm2 start ./.ubuntu-service-start --name ${this.shell(serviceName)} --interpreter bash >/dev/null
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

    const state = this.state;
    await this.nginx.proxyRouteIsRunning({
      name: serviceName,
      hostname: state.host,
      pathname: state.path,
      upstreamPort: listenPort,
    });

    const healthUrl = `https://${state.host}${state.path}`;
    const health = await fetch(healthUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    const healthState = await health.json() as { name?: unknown };
    if (!health.ok || healthState.name !== serviceName) {
      throw new Error(`WebRTC 信令公网健康检查失败: HTTP ${health.status}`);
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const socket = new WebSocket(
        `wss://${state.host}${state.path}/ubuntu-lib-health`,
      );
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
            || message.projectName !== "ubuntu-lib-health"
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
  }

  private shell(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }
}
