import fs, { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire, isBuiltin } from "node:module";
import compressing from "compressing";
import { init, parse } from "es-module-lexer";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import forward from "../Forward/index.ts";
import nginx from "../Nginx/index.ts";
import pm2 from "../Pm2/index.ts";
import publicRuntime from "../Public/index.ts";
import sftp from "../Sftp/index.ts";
import store from "../store.ts";

type RegisteredForward = ReturnType<typeof forward.register>;

class Vite {
  private readonly data = {
    forwards: new Map<number, RegisteredForward>(),
  };

  /** 为 Hono 与其 React 项目建立开发隧道，并在构建后发布 Node 服务。 */
  public honoReact(): Plugin {
    return this.plugin("honoReact");
  }

  /** 为普通 React 项目建立开发隧道，并在构建后发布静态站点。 */
  public react(): Plugin {
    return this.plugin("react");
  }

  /** 为 Electron Renderer 的 Vite 开发服务建立并清理公网隧道。 */
  public electronRenderer(): Plugin {
    return this.plugin("electronRenderer");
  }

  private plugin(scene: "honoReact" | "react" | "electronRenderer"): Plugin {
    const data: {
      configurations: ResolvedConfig[];
      rootConfig?: ResolvedConfig;
      port: number;
    } = {
      configurations: [],
      port: 0,
    };
    return {
      name: `extends-ssh:${scene}`,
      enforce: "post",
      config: (_config, environment) => environment.command === "serve" ? ({
          server: {
            allowedHosts: [`.dev.${nginx.state.domain}`],
            host: "127.0.0.1",
            strictPort: true,
          },
        }) : undefined,
      configResolved: config => {
        data.port = this.portRequired(config.server.port);
        if (config.command === "build" && scene !== "electronRenderer") {
          data.rootConfig ??= config;
          data.configurations.push(config);
        }
      },
      configureServer: server => this.tunnelConfigure(server, data.port),
      closeBundle: async () => {
        const config = data.configurations.pop();
        if (!config) return;
        if (config !== data.rootConfig) return;
        if (scene === "honoReact") {
          const port = this.portRequired(config.server.port);
          const projectRoot = config.configFile ? path.dirname(config.configFile) : process.cwd();
          const packagePath = path.resolve(projectRoot, "package.json");
          if (!existsSync(packagePath)) throw new Error(`项目 package.json 不存在: ${packagePath}`);
          const projectPackage = JSON.parse(
            await fs.promises.readFile(packagePath, "utf8"),
          ) as { name?: string };
          if (!projectPackage.name || !/^[A-Za-z0-9._~-]+$/.test(projectPackage.name)) {
            throw new Error(
              `项目 package.json name 不是单一路径名称: ${String(projectPackage.name)}`,
            );
          }
          const localPath = path.resolve(projectRoot, "dist");
          const entry = path.resolve(localPath, projectPackage.name, "index.js");
          if (!existsSync(entry)) throw new Error(`Node 构建入口不存在: ${entry}`);
          const command = `node dist/${projectPackage.name}/index.js`;
          const deploymentPackage = await this.packageCreate({ localPath, projectRoot, port });
          try {
            const remotePath = await this.upload({ localPath, port, preserveDirectory: true });
            await sftp.remoteUpload(
              deploymentPackage,
              `${remotePath}/package.json`,
            );
            await pm2.isRemoteRunning();
            const processName = `vite-node-${port}`;
            const startResult = await publicRuntime.execute(`
set -e
pm2 delete ${this.shell(processName)} >/dev/null 2>&1 || true
pm2 delete ${this.shell(`vite-static-${port}`)} >/dev/null 2>&1 || true
cd ${this.shell(remotePath)}
npm install --omit=dev --no-package-lock
PORT=${port} HOST=127.0.0.1 \\
  pm2 start bash --name ${this.shell(processName)} -- -lc ${this.shell(command)}
pm2 save --force >/dev/null
printf node > .extends-ssh-kind
for attempt in $(seq 1 20); do
  ROOT_PID=$(pm2 pid ${this.shell(processName)})
  if [ -n "$ROOT_PID" ] && [ "$ROOT_PID" != 0 ]; then
    PIDS="$ROOT_PID"
    CURRENT="$ROOT_PID"
    while [ -n "$CURRENT" ]; do
      CHILDREN=""
      for PID in $CURRENT; do CHILDREN="$CHILDREN $(pgrep -P "$PID" 2>/dev/null || true)"; done
      PIDS="$PIDS $CHILDREN"
      CURRENT="$CHILDREN"
    done
    PORTS=$(for PID in $PIDS; do
      lsof -Pan -p "$PID" -iTCP -sTCP:LISTEN -Fn 2>/dev/null || true
    done | sed -n 's/^n.*:\\([0-9][0-9]*\\)$/\\1/p' | sort -nu)
    PORT_COUNT=$(printf '%s\n' "$PORTS" | sed '/^$/d' | wc -l)
    if [ "$PORT_COUNT" = 1 ]; then
      SERVICE_PORT=$(printf '%s' "$PORTS" | head -n 1)
      printf '%s' "$SERVICE_PORT" > .extends-ssh-upstream-port
      printf 'EXTENDS_SSH_UPSTREAM=%s\n' "$SERVICE_PORT"
      exit 0
    fi
  fi
  sleep 0.5
done
pm2 logs ${this.shell(processName)} --lines 40 --nostream >&2 || true
echo '无法从 PM2 进程树确定唯一监听端口' >&2
exit 1
`);
            const upstreamMatch = startResult.stdout.match(/EXTENDS_SSH_UPSTREAM=(\d+)/);
            const upstreamPort = this.portRequired(Number(upstreamMatch?.[1]));
            await nginx.proxyRouteIsRunning({
              name: `vite-${port}`,
              hostname: this.hostname(port),
              pathname: "/",
              upstreamPort,
            });
            await this.publicVerify(port, true);
          } finally {
            await fs.promises.rm(deploymentPackage, { force: true });
          }
        }
        if (scene === "react") {
          const localPath = path.resolve(config.root, config.build.outDir);
          if (!existsSync(localPath)) throw new Error(`Vite 构建目录不存在: ${localPath}`);
          const port = this.portRequired(config.server.port);
          const remotePath = await this.upload({ localPath, port });
          await publicRuntime.execute(`
pm2 delete ${this.shell(`vite-static-${port}`)} >/dev/null 2>&1 || true
pm2 delete ${this.shell(`vite-node-${port}`)} >/dev/null 2>&1 || true
pm2 save --force >/dev/null 2>&1 || true
`);
          await this.staticRoute({ port, remotePath });
          await this.publicVerify(port);
        }
      },
    };
  }

  private tunnelConfigure(server: ViteDevServer, port: number): void {
    const httpServer = server.httpServer;
    if (!httpServer) throw new Error("Vite 开发服务器没有 HTTP Server");
    const data: { startPromise?: Promise<void> } = {};
    httpServer.once("listening", () => {
      const address = httpServer.address();
      const start = async () => {
        if (!address || typeof address === "string" || address.port !== port) {
          throw new Error(`Vite 未按项目端口 ${port} 启动`);
        }
        await this.tunnelStart(port);
      };
      data.startPromise = start();
      void data.startPromise.catch(error => {
        process.exitCode = 1;
        server.config.logger.error(
          error instanceof Error ? error.stack ?? error.message : String(error),
        );
        void server.close();
      });
    });
    httpServer.once("close", () => {
      void (async () => {
        await data.startPromise?.catch(() => undefined);
        await this.tunnelClose(port);
      })();
    });
  }

  private async tunnelStart(port: number): Promise<void> {
    const current = this.data.forwards.get(port);
    if (current) {
      const state = await current.isRunning();
      await nginx.proxyRouteIsRunning({
        name: `vite-${port}`,
        hostname: this.hostname(port),
        pathname: "/",
        upstreamPort: this.portRequired(state.remotePort),
      });
      await this.publicVerify(port, false, "/__vite_ping");
      return;
    }
    const registeredForward = forward.register({
      name: `vite-${port}`,
      local: { host: "127.0.0.1", port },
      remote: { host: "127.0.0.1", port: 0 },
    });
    const state = await registeredForward.isRunning();
    this.data.forwards.set(port, registeredForward);
    try {
      await nginx.proxyRouteIsRunning({
        name: `vite-${port}`,
        hostname: this.hostname(port),
        pathname: "/",
        upstreamPort: this.portRequired(state.remotePort),
      });
      await this.publicVerify(port, false, "/__vite_ping");
    } catch (error) {
      this.data.forwards.delete(port);
      await registeredForward.close();
      await this.tunnelClose(port);
      throw error;
    }
  }

  private async tunnelClose(port: number): Promise<void> {
    const forward = this.data.forwards.get(port);
    if (forward) {
      this.data.forwards.delete(port);
      await forward.close();
    }
    const remotePath = `${store.getState().public.remoteRoot}/vite-${port}`;
    const kindPath = `${remotePath}/.extends-ssh-kind`;
    const kind = (await publicRuntime.execute(
      `test -f ${this.shell(kindPath)} && cat ${this.shell(kindPath)} || true`,
    )).stdout.trim();
    if (kind === "static") await this.staticRoute({ port, remotePath });
    if (kind === "node") {
      const result = await publicRuntime.execute(
        `cat ${this.shell(`${remotePath}/.extends-ssh-upstream-port`)}`,
      );
      const upstreamPort = this.portRequired(Number(result.stdout.trim()));
      await nginx.proxyRouteIsRunning({
        name: `vite-${port}`,
        hostname: this.hostname(port),
        pathname: "/",
        upstreamPort,
      });
    }
    if (!kind) {
      await nginx.routeClose({
        name: `vite-${port}`,
        hostname: this.hostname(port),
      });
    }
  }

  private async upload({ localPath, port, preserveDirectory = false }: {
    localPath: string;
    port: number;
    preserveDirectory?: boolean;
  }): Promise<string> {
    await this.connect();
    const remotePath = `${store.getState().public.remoteRoot}/vite-${port}`;
    const remoteSource = preserveDirectory
      ? `${remotePath}/${path.basename(localPath)}`
      : remotePath;
    const remoteZip = `${remotePath}/site.zip`;
    const localZip = path.join(os.tmpdir(), `extends-ssh-${port}-${process.pid}.zip`);
    try {
      await compressing.zip.compressDir(localPath, localZip, { ignoreBase: true });
      await publicRuntime.execute(
        `rm -rf ${this.shell(remotePath)} && mkdir -p ${this.shell(remoteSource)}`,
      );
      await sftp.remoteUpload(localZip, remoteZip);
      const unzip = `unzip -oq ${this.shell(remoteZip)} -d ${this.shell(remoteSource)}`;
      await publicRuntime.execute(`${unzip} && rm -f ${this.shell(remoteZip)}`);
      return remotePath;
    } finally {
      await fs.promises.rm(localZip, { force: true });
    }
  }

  private async packageCreate({ localPath, projectRoot, port }: {
    localPath: string;
    projectRoot: string;
    port: number;
  }): Promise<string> {
    const packagePath = path.resolve(projectRoot, "package.json");
    if (!existsSync(packagePath)) throw new Error(`Node 项目 package.json 不存在: ${packagePath}`);
    const sourcePackage = JSON.parse(await fs.promises.readFile(packagePath, "utf8")) as {
      name?: string;
      type?: string;
      dependencies?: Record<string, string>;
    };
    const dependencies: Record<string, string> = {};
    const require = createRequire(packagePath);
    const packageResolve = (name: string): string | undefined => {
      let searchRoot = projectRoot;
      while (true) {
        const candidate = path.join(searchRoot, "node_modules", name, "package.json");
        if (existsSync(candidate)) return candidate;
        const parent = path.dirname(searchRoot);
        if (parent === searchRoot) break;
        searchRoot = parent;
      }
      try {
        let directory = path.dirname(require.resolve(name));
        while (path.dirname(directory) !== directory) {
          const candidate = path.join(directory, "package.json");
          if (existsSync(candidate)) {
            const current = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: string };
            if (current.name === name) return candidate;
          }
          directory = path.dirname(directory);
        }
      } catch {
        return;
      }
    };
    const external = new Set<string>();
    await init;
    const files = await fs.promises.readdir(localPath, { recursive: true });
    for (const file of files.filter(value => /\.[cm]?js$/.test(value))) {
      const source = await fs.promises.readFile(path.resolve(localPath, file), "utf8");
      for (const item of parse(source)[0]) {
        const specifier = item.n;
        if (
          !specifier
          || specifier.startsWith(".")
          || specifier.startsWith("/")
          || specifier.startsWith("#")
          || isBuiltin(specifier)
        ) continue;
        external.add(specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0]);
      }
    }
    for (const name of external) {
      const configured = sourcePackage.dependencies?.[name];
      if (configured?.startsWith("workspace:")) {
        throw new Error(`Node 构建产物仍依赖 workspace 包 ${name}`);
      }
      const dependencyPath = packageResolve(name);
      if (!dependencyPath) throw new Error(`无法定位 Node 外部依赖: ${name}`);
      const dependency = JSON.parse(await fs.promises.readFile(dependencyPath, "utf8")) as {
        version?: string;
        peerDependencies?: Record<string, string>;
      };
      if (!dependency.version) throw new Error(`无法确定 Node 外部依赖版本: ${name}`);
      dependencies[name] = configured ?? dependency.version;
      for (const peerName of Object.keys(dependency.peerDependencies ?? {})) {
        if (packageResolve(peerName)) external.add(peerName);
      }
    }
    const deploymentPackage = path.join(
      os.tmpdir(),
      `extends-ssh-package-${port}-${process.pid}.json`,
    );
    await fs.promises.writeFile(deploymentPackage, `${JSON.stringify({
      name: sourcePackage.name ?? `vite-node-${port}`,
      private: true,
      type: sourcePackage.type ?? "module",
      dependencies,
    }, null, 2)}\n`, "utf8");
    return deploymentPackage;
  }

  private async staticRoute(
    { port, remotePath }: { port: number; remotePath: string },
  ): Promise<void> {
    await publicRuntime.execute(`
set -e
printf static > ${this.shell(`${remotePath}/.extends-ssh-kind`)}
`);
    await nginx.staticRouteIsRunning({
      name: `vite-${port}`,
      hostname: this.hostname(port),
      pathname: "/",
      root: remotePath,
      spaFallback: true,
    });
  }

  private async publicVerify(
    port: number,
    notFoundAllowed = false,
    pathname = "/",
  ): Promise<void> {
    const url = `https://${this.hostname(port)}${pathname}`;
    const deadline = Date.now() + 15_000;
    let failure: unknown;
    while (Date.now() < deadline) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3_000);
      try {
        const response = await fetch(url, {
          headers: pathname === "/__vite_ping" ? { Accept: "text/x-vite-ping" } : undefined,
          redirect: "manual",
          signal: controller.signal,
        });
        if (response.status < 400 || (notFoundAllowed && response.status === 404)) return;
        failure = new Error(`HTTP ${response.status}`);
      } catch (error) {
        failure = error;
      } finally {
        clearTimeout(timeout);
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`公网 HTTPS 验证失败 ${url}`, { cause: failure });
  }

  private async connect(): Promise<void> {
    await publicRuntime.sshIsRunning();
    await publicRuntime.execute(`mkdir -p ${this.shell(store.getState().public.remoteRoot)}`);
  }

  private portRequired(port: unknown): number {
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`端口必须是 1-65535 的整数，收到 ${String(port)}`);
    }
    return port;
  }

  private hostname(port: number): string {
    return `vite-${this.portRequired(port)}.dev.${nginx.state.domain}`;
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

}

export default new Vite();
