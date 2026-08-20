import { existsSync } from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import type Forward from "../Forward/index.ts";
import type Nginx from "../Nginx/index.ts";
import type Nodejs from "../Nodejs/index.ts";
import type Pm2 from "../Pm2/index.ts";
import type Sftp from "../Sftp/index.ts";
import store from "../store.ts";

type RegisteredForward = ReturnType<Forward["register"]>;
export default abstract class Vite {
  protected abstract readonly forward: Forward;
  protected abstract readonly nginx: Nginx;
  protected abstract readonly nodejs: Nodejs;
  protected abstract readonly pm2: Pm2;
  protected abstract readonly sftp: Sftp;

  private portRequired(port: number) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new RangeError(`Vite 端口必须是 1-65535 的整数: ${String(port)}`);
    }
    return port;
  }

  private targetResolve(port: number) {
    const targetPort = this.portRequired(port);
    const name = `vite-${targetPort}`;
    const remotePath = path.posix.join(store.getState().public.remoteRoot, name);
    return {
      hostname: `${name}.dev.${this.nginx.state.domain}`,
      kindPath: path.posix.join(remotePath, ".extends-ssh-kind"),
      name,
      port: targetPort,
      remotePath,
    };
  }

  private async publicVerify(
    hostname: string,
    pathname: `/${string}`,
    options?: { accept?: string; isNotFoundAccepted?: boolean },
  ) {
    const url = `https://${hostname}${pathname}`;
    const deadline = Date.now() + 15_000;
    let lastFailure: Error = new Error(`Vite 公网验证尚未开始: ${url}`);

    while (Date.now() < deadline) {
      const requestController = new AbortController();
      const requestTimeout = setTimeout(
        () => requestController.abort(),
        Math.min(3_000, deadline - Date.now()),
      );
      try {
        const request: RequestInit = { signal: requestController.signal };
        if (options?.accept) {
          request.headers = { Accept: options.accept };
        }
        const response = await fetch(url, request);
        if (
          response.status < 400 ||
          (options?.isNotFoundAccepted === true && response.status === 404)
        ) {
          return;
        }
        lastFailure = new Error(`Vite 公网验证返回 HTTP ${response.status}: ${url}`);
      } catch (error) {
        lastFailure = error instanceof Error ? error : new Error(String(error));
      } finally {
        clearTimeout(requestTimeout);
      }

      const retryDelay = Math.min(250, deadline - Date.now());
      if (retryDelay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    throw lastFailure;
  }

  public state(port: number) {
    const target = this.targetResolve(port);
    return { host: target.hostname, port: 443 as const, secure: true as const };
  }

  public readonly dev = {
    forward: (): Plugin => {
      let configuredPort: number | undefined;
      let registeredForward: RegisteredForward | undefined;
      let resolvedConfig: ResolvedConfig | undefined;
      let resourcesClosePromise: Promise<void> | undefined;
      let startPromise: Promise<void> | undefined;

      return {
        name: "extends-ssh:dev:forward",
        config: (_config, environment) => {
          if (environment.command !== "serve") {
            return;
          }
          return {
            server: {
              allowedHosts: [`.dev.${this.nginx.state.domain}`],
              host: "127.0.0.1",
              strictPort: true,
            },
          };
        },
        configResolved: (config) => {
          configuredPort = this.portRequired(config.server.port);
          resolvedConfig = config;
        },
        configureServer: (server) => {
          const httpServer = server.httpServer;
          if (!httpServer) {
            throw new Error("Vite 开发服务器没有 HTTP Server");
          }
          if (configuredPort === undefined || resolvedConfig === undefined) {
            throw new Error("Vite 开发配置尚未完成解析");
          }

          const config = resolvedConfig;
          const target = this.targetResolve(configuredPort);
          const failureLog = (phase: string, error: unknown) => {
            process.exitCode = 1;
            const detail =
              error instanceof Error ? (error.stack ?? error.message) : String(error);
            config.logger.error(`[extends-ssh:dev:forward] ${phase}: ${detail}`);
          };
          const resourcesClose = () => {
            if (resourcesClosePromise) {
              return resourcesClosePromise;
            }
            resourcesClosePromise = Promise.resolve().then(async () => {
              const activeForward = registeredForward;
              registeredForward = undefined;
              if (activeForward) {
                try {
                  await activeForward.close();
                } catch (error) {
                  failureLog("SSH 转发关闭失败", error);
                }
              }

              try {
                const productionKind = (
                  await this.sftp.remoteTextRead(target.kindPath)
                )?.trim();
                if (productionKind === "static") {
                  await this.nginx.staticRouteIsRunning({
                    name: target.name,
                    hostname: target.hostname,
                    pathname: "/",
                    root: target.remotePath,
                    spaFallback: true,
                  });
                } else if (productionKind === "node") {
                  await this.nginx.proxyRouteIsRunning({
                    name: target.name,
                    hostname: target.hostname,
                    pathname: "/",
                    upstreamPort: target.port,
                  });
                } else {
                  await this.nginx.routeClose({
                    name: target.name,
                    hostname: target.hostname,
                  });
                }
              } catch (error) {
                failureLog("生产路由恢复失败", error);
              }
            });
            return resourcesClosePromise;
          };

          httpServer.once("listening", () => {
            startPromise = Promise.resolve().then(async () => {
              try {
                const address = httpServer.address();
                if (address === null || typeof address === "string") {
                  throw new Error("Vite HTTP Server 没有 TCP 地址");
                }
                const listeningPort = this.portRequired(address.port);
                if (listeningPort !== target.port) {
                  throw new Error(
                    `Vite 实际端口 ${listeningPort} 与配置端口 ${target.port} 不一致`,
                  );
                }

                registeredForward = this.forward.register({
                  name: target.name,
                  local: { host: "127.0.0.1", port: target.port },
                  remote: { host: "127.0.0.1", port: 0 },
                });
                const { remotePort } = await registeredForward.isRunning();
                await this.nginx.proxyRouteIsRunning({
                  name: target.name,
                  hostname: target.hostname,
                  pathname: "/",
                  upstreamPort: this.portRequired(remotePort),
                });
                await this.publicVerify(target.hostname, "/__vite_ping", {
                  accept: "text/x-vite-ping",
                });
              } catch (error) {
                failureLog("启动失败", error);
                await resourcesClose();
                try {
                  await server.close();
                } catch (closeError) {
                  failureLog("Vite Server 关闭失败", closeError);
                }
              }
            });
          });

          httpServer.once("close", () => {
            if (startPromise) {
              void startPromise.then(() => resourcesClose());
            } else {
              void resourcesClose();
            }
          });
        },
      };
    },
  };

  public readonly pro = {
    sftp: (): Plugin => {
      let resolvedConfig: ResolvedConfig | undefined;
      return {
        name: "extends-ssh:pro:sftp",
        configResolved: (config) => {
          if (config.command === "build") {
            this.portRequired(config.server.port);
            resolvedConfig = config;
          }
        },
        closeBundle: async () => {
          const config = resolvedConfig;
          resolvedConfig = undefined;
          if (!config) {
            return;
          }

          const target = this.targetResolve(config.server.port);
          const buildPath = path.resolve(config.root, config.build.outDir);
          if (!existsSync(buildPath)) {
            throw new Error(`Vite 构建目录不存在: ${buildPath}`);
          }

          await this.sftp.remoteDirectoryReplace(buildPath, target.remotePath);
          await this.pm2.processRemoteClose(`vite-node-${target.port}`);
          await this.sftp.remoteTextUpload("static", target.kindPath);
          await this.nginx.staticRouteIsRunning({
            name: target.name,
            hostname: target.hostname,
            pathname: "/",
            root: target.remotePath,
            spaFallback: true,
          });
          await this.publicVerify(target.hostname, "/");
        },
      };
    },
    nodejs: (): Plugin => {
      let resolvedConfig: ResolvedConfig | undefined;
      return {
        name: "extends-ssh:pro:nodejs",
        configResolved: (config) => {
          if (config.command === "build") {
            this.portRequired(config.server.port);
            resolvedConfig = config;
          }
        },
        closeBundle: async () => {
          const config = resolvedConfig;
          resolvedConfig = undefined;
          if (!config) {
            return;
          }

          const target = this.targetResolve(config.server.port);
          const projectPath = config.configFile
            ? path.dirname(config.configFile)
            : process.cwd();
          const buildPath = path.resolve(projectPath, "dist");
          if (!existsSync(buildPath)) {
            throw new Error(`Node 构建目录不存在: ${buildPath}`);
          }

          const deploymentPackage = await this.nodejs.deploymentPackageCreate(
            buildPath,
            projectPath,
          );
          const entryPath = path.resolve(
            buildPath,
            deploymentPackage.name,
            "index.js",
          );
          if (!existsSync(entryPath)) {
            throw new Error(`Node 构建入口不存在: ${entryPath}`);
          }

          const processName = `vite-node-${target.port}`;
          await this.sftp.remoteDirectoryReplace(
            buildPath,
            path.posix.join(target.remotePath, "dist"),
          );
          await this.sftp.remoteTextUpload(
            deploymentPackage.content,
            path.posix.join(target.remotePath, "package.json"),
          );
          await this.nodejs.dependenciesRemoteInstall(target.remotePath);
          await this.pm2.processIsRemoteRunning({
            name: processName,
            path: target.remotePath,
            command: `node dist/${deploymentPackage.name}/index.js`,
            port: target.port,
            environment: { HOST: "127.0.0.1", PORT: String(target.port) },
          });
          await this.sftp.remoteTextUpload("node", target.kindPath);
          await this.nginx.proxyRouteIsRunning({
            name: target.name,
            hostname: target.hostname,
            pathname: "/",
            upstreamPort: target.port,
          });
          await this.publicVerify(target.hostname, "/", { isNotFoundAccepted: true });
        },
      };
    },
  };
}
