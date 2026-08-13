import { existsSync } from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import store from "./store.ts";

const portRequired = (port: number): number => {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError(`Vite 端口必须是 1-65535 的整数: ${String(port)}`);
  }
  return port;
};

const serviceRead = (port: number) => ({
  host: `vite-${portRequired(port)}.dev.${store.getState().Public.domain.trim().toLowerCase()}`,
  port: store.getState().Nginx.httpsPort,
  secure: store.getState().Nginx.secure,
});

const remotePath = (port: number): string =>
  `${store.getState().Public.remoteRoot}/vite-${portRequired(port)}`;

const staticRoute = async (port: number, root: string): Promise<void> => {
  await store.getState().NginxActions.staticRouteIsRunning({
    name: `vite-${port}`,
    hostname: serviceRead(port).host,
    pathname: "/",
    root,
    spaFallback: true,
  });
};

const proxyRoute = async (port: number, upstreamPort: number): Promise<void> => {
  await store.getState().NginxActions.proxyRouteIsRunning({
    name: `vite-${port}`,
    hostname: serviceRead(port).host,
    pathname: "/",
    upstreamPort: portRequired(upstreamPort),
  });
};

const publicVerify = async (
  port: number,
  pathname = "/",
  notFoundAllowed = false,
): Promise<void> => {
  const service = serviceRead(port);
  const url = `${service.secure ? "https" : "http"}://${service.host}${pathname}`;
  const deadline = Date.now() + 15_000;
  let failure: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers: pathname === "/__vite_ping"
          ? { Accept: "text/x-vite-ping" }
          : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      });
      if (response.status < 400 || (notFoundAllowed && response.status === 404)) return;
      failure = new Error(`HTTP ${response.status}`);
    } catch (error) {
      failure = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(
    `Vite 公网验证失败 ${url}: ${failure instanceof Error ? failure.message : String(failure)}`,
  );
};

const vitePlugin = {
  forward(): Plugin {
    let port = 0;
    let registeredForward: ReturnType<
      ReturnType<typeof store.getState>["ForwardActions"]["register"]
    > | undefined;
    const configure = (server: ViteDevServer): void => {
      const httpServer = server.httpServer;
      if (!httpServer) throw new Error("Vite 开发服务器没有 HTTP Server");
      let startPromise: Promise<void> | undefined;
      httpServer.once("listening", () => {
        startPromise = (async () => {
          const address = httpServer.address();
          if (!address || typeof address === "string" || address.port !== port) {
            throw new Error(`Vite 未按项目端口 ${port} 启动`);
          }
          registeredForward = store.getState().ForwardActions.register({
            name: `vite-${port}`,
            local: { host: "127.0.0.1", port },
            remote: { host: "127.0.0.1", port: 0 },
          });
          await proxyRoute(port, (await registeredForward.isRunning()).remotePort);
          await publicVerify(port, "/__vite_ping");
        })();
        void startPromise.catch(error => {
          process.exitCode = 1;
          server.config.logger.error(
            error instanceof Error ? error.stack ?? error.message : String(error),
          );
          void server.close();
        });
      });
      httpServer.once("close", () => {
        void (async () => {
          await startPromise?.catch(() => undefined);
          await registeredForward?.close();
          registeredForward = undefined;
          const projectRemotePath = remotePath(port);
          const kind = await store.getState().SftpActions.remoteTextRead(
            `${projectRemotePath}/.extends-ssh-kind`,
          );
          if (kind === "static") await staticRoute(port, projectRemotePath);
          if (kind === "node") await proxyRoute(port, port);
          if (!kind) {
            await store.getState().NginxActions.routeClose({
              name: `vite-${port}`,
              hostname: serviceRead(port).host,
            });
          }
        })().catch(error => {
          process.exitCode = 1;
          server.config.logger.error(
            error instanceof Error ? error.stack ?? error.message : String(error),
          );
        });
      });
    };
    return {
      name: "src-lib:vite-forward",
      enforce: "post",
      config: (_config, environment) => environment.command === "serve"
        ? {
            server: {
              allowedHosts: [
                `.dev.${store.getState().Public.domain.trim().toLowerCase()}`,
              ],
              host: "127.0.0.1",
              strictPort: true,
            },
          }
        : undefined,
      configResolved(config) {
        port = portRequired(config.server.port);
      },
      configureServer: configure,
    };
  },

  static(): Plugin {
    let buildConfig: ResolvedConfig | undefined;
    return {
      name: "src-lib:vite-static",
      enforce: "post",
      configResolved(config) {
        if (config.command === "build") buildConfig = config;
      },
      async closeBundle() {
        const config = buildConfig;
        buildConfig = undefined;
        if (!config) return;
        const buildPath = path.resolve(config.root, config.build.outDir);
        if (!existsSync(buildPath)) {
          throw new Error(`Vite 构建目录不存在: ${buildPath}`);
        }
        const port = portRequired(config.server.port);
        const projectRemotePath = remotePath(port);
        await store.getState().SftpActions.remoteDirectoryReplace(
          buildPath,
          projectRemotePath,
        );
        await store.getState().Pm2Actions.processRemoteClose(`vite-node-${port}`);
        await store.getState().SftpActions.remoteTextUpload(
          "static",
          `${projectRemotePath}/.extends-ssh-kind`,
        );
        await staticRoute(port, projectRemotePath);
        await publicVerify(port);
      },
    };
  },

  node(): Plugin {
    let buildConfig: ResolvedConfig | undefined;
    return {
      name: "src-lib:vite-node",
      enforce: "post",
      configResolved(config) {
        if (config.command === "build") buildConfig = config;
      },
      async closeBundle() {
        const config = buildConfig;
        buildConfig = undefined;
        if (!config) return;
        const port = portRequired(config.server.port);
        const projectPath = config.configFile
          ? path.dirname(config.configFile)
          : process.cwd();
        const buildPath = path.resolve(projectPath, "dist");
        if (!existsSync(buildPath)) {
          throw new Error(`Node 构建目录不存在: ${buildPath}`);
        }
        const deploymentPackage = await store
          .getState()
          .NodejsActions.deploymentPackageCreate(buildPath, projectPath);
        const entry = path.resolve(buildPath, deploymentPackage.name, "index.js");
        if (!existsSync(entry)) throw new Error(`Node 构建入口不存在: ${entry}`);
        const projectRemotePath = remotePath(port);
        const processName = `vite-node-${port}`;
        await store.getState().SftpActions.remoteDirectoryReplace(
          buildPath,
          `${projectRemotePath}/dist`,
        );
        await store.getState().SftpActions.remoteTextUpload(
          deploymentPackage.content,
          `${projectRemotePath}/package.json`,
        );
        await store.getState().NodejsActions.dependenciesRemoteInstall(projectRemotePath);
        await store.getState().Pm2Actions.processIsRemoteRunning({
          name: processName,
          path: projectRemotePath,
          command: `node dist/${deploymentPackage.name}/index.js`,
          port,
          environment: { HOST: "127.0.0.1", PORT: String(port) },
        });
        await store.getState().SftpActions.remoteTextUpload(
          "node",
          `${projectRemotePath}/.extends-ssh-kind`,
        );
        await proxyRoute(port, port);
        await publicVerify(port, "/", true);
      },
    };
  },
};

export { vitePlugin };
export default store;
