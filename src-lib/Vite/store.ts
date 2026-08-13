import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

type RegisteredForward = {
  readonly state: {
    name: string;
    local: { host: string; port: number };
    remote: { host: string; port: number };
  };
  isRunning(): Promise<{ remotePort: number }>;
  close(): Promise<void>;
};

type ViteSlice = {
  ViteActions: {
    forwardPlugin(): Plugin;
    staticPlugin(): Plugin;
    nodePlugin(): Plugin;
  };
};

type ViteDependencies = {
  Public: {
    domain: string;
    remoteRoot: string;
  };
  ForwardActions: {
    register(registration: {
      name: string;
      local: { host: string; port: number };
      remote: { host: string; port: number };
    }): RegisteredForward;
  };
  Nginx: {
    httpPort: 80;
    httpsPort: 443;
    secure: true;
  };
  NginxActions: {
    proxyRouteIsRunning(route: {
      name: string;
      hostname: string;
      pathname: string;
      upstreamPort: number;
    }): Promise<void>;
    staticRouteIsRunning(route: {
      name: string;
      hostname: string;
      pathname: string;
      root: string;
      spaFallback: boolean;
    }): Promise<void>;
    routeClose(route: { name: string; hostname: string }): Promise<void>;
  };
  NodejsActions: {
    deploymentPackageCreate(
      buildPath: string,
      projectPath: string,
    ): Promise<{ content: string; name: string }>;
    dependenciesRemoteInstall(projectPath: string): Promise<void>;
  };
  Pm2Actions: {
    processIsRemoteRunning(process: {
      name: string;
      path: string;
      command: string;
      port: number;
      environment?: Record<string, string>;
    }): Promise<void>;
    processRemoteClose(name: string): Promise<void>;
  };
  SftpActions: {
    remoteDirectoryReplace(localPath: string, remotePath: string): Promise<void>;
    remoteTextUpload(text: string, remotePath: string): Promise<void>;
    remoteTextRead(remotePath: string): Promise<string | undefined>;
  };
};

const s: immerStateCreator<ViteSlice, ViteDependencies> = (_set, get) => {
  const portRequired = (port: number): number => {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new TypeError(`Vite 端口必须是 1-65535 的整数: ${String(port)}`);
    }
    return port;
  };
  const serviceRead = (port: number) => ({
    host: `vite-${portRequired(port)}.dev.${get().Public.domain.trim().toLowerCase()}`,
    port: 443 as const,
    secure: true as const,
  });
  const remotePath = (port: number): string =>
    `${get().Public.remoteRoot}/vite-${portRequired(port)}`;
  const staticRoute = async (port: number, root: string): Promise<void> => {
    await get().NginxActions.staticRouteIsRunning({
      name: `vite-${port}`,
      hostname: serviceRead(port).host,
      pathname: "/",
      root,
      spaFallback: true,
    });
  };
  const proxyRoute = async (port: number, upstreamPort: number): Promise<void> => {
    await get().NginxActions.proxyRouteIsRunning({
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
    const url = `https://${serviceRead(port).host}${pathname}`;
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

  return {
    ViteActions: {
      forwardPlugin() {
        let port = 0;
        let registeredForward: RegisteredForward | undefined;
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
              registeredForward = get().ForwardActions.register({
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
              const kind = await get().SftpActions.remoteTextRead(
                `${projectRemotePath}/.extends-ssh-kind`,
              );
              if (kind === "static") await staticRoute(port, projectRemotePath);
              if (kind === "node") await proxyRoute(port, port);
              if (!kind) {
                await get().NginxActions.routeClose({
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
                  allowedHosts: [`.dev.${get().Public.domain.trim().toLowerCase()}`],
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
      staticPlugin() {
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
            await get().SftpActions.remoteDirectoryReplace(buildPath, projectRemotePath);
            await get().Pm2Actions.processRemoteClose(`vite-node-${port}`);
            await get().SftpActions.remoteTextUpload(
              "static",
              `${projectRemotePath}/.extends-ssh-kind`,
            );
            await staticRoute(port, projectRemotePath);
            await publicVerify(port);
          },
        };
      },
      nodePlugin() {
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
            const deploymentPackage = await get().NodejsActions.deploymentPackageCreate(
              buildPath,
              projectPath,
            );
            const entry = path.resolve(
              buildPath,
              deploymentPackage.name,
              "index.js",
            );
            if (!existsSync(entry)) throw new Error(`Node 构建入口不存在: ${entry}`);
            const projectRemotePath = remotePath(port);
            const processName = `vite-node-${port}`;
            await get().SftpActions.remoteDirectoryReplace(
              buildPath,
              `${projectRemotePath}/dist`,
            );
            await get().SftpActions.remoteTextUpload(
              deploymentPackage.content,
              `${projectRemotePath}/package.json`,
            );
            await get().NodejsActions.dependenciesRemoteInstall(projectRemotePath);
            await get().Pm2Actions.processIsRemoteRunning({
              name: processName,
              path: projectRemotePath,
              command: `node dist/${deploymentPackage.name}/index.js`,
              port,
              environment: { HOST: "127.0.0.1", PORT: String(port) },
            });
            await get().SftpActions.remoteTextUpload(
              "node",
              `${projectRemotePath}/.extends-ssh-kind`,
            );
            await proxyRoute(port, port);
            await publicVerify(port, "/", true);
          },
        };
      },
    },
  };
};

export default s;
