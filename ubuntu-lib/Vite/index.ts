import { existsSync } from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import type Forward from "../Forward/index.ts";
import type Nginx from "../Nginx/index.ts";
import type Nodejs from "../Nodejs/index.ts";
import type Pm2 from "../Pm2/index.ts";
import type Sftp from "../Sftp/index.ts";
import store from "../store.ts";

type RegisteredForward = ReturnType<Forward["register"]>;
type Scene = "honoReact" | "react" | "electronRenderer";

export default abstract class Vite {
  protected abstract readonly forward: Forward;
  protected abstract readonly nginx: Nginx;
  protected abstract readonly nodejs: Nodejs;
  protected abstract readonly pm2: Pm2;
  protected abstract readonly sftp: Sftp;
  private readonly forwards = new Map<number, RegisteredForward>();

  public state(port: number) {
    return {
      host: this.hostname(port),
      port: 443 as const,
      secure: true as const,
    };
  }

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

  private plugin(scene: Scene): Plugin {
    let config: ResolvedConfig | undefined;
    let port = 0;
    return {
      name: `extends-ssh:${scene}`,
      enforce: "post",
      config: (_config, environment) => environment.command === "serve" ? ({
          server: {
            allowedHosts: [`.dev.${this.nginx.state.domain}`],
            host: "127.0.0.1",
            strictPort: true,
          },
        }) : undefined,
      configResolved: resolvedConfig => {
        port = this.portRequired(resolvedConfig.server.port);
        if (resolvedConfig.command === "build" && scene !== "electronRenderer") {
          config = resolvedConfig;
        }
      },
      configureServer: server => this.tunnelConfigure(server, port),
      closeBundle: async () => {
        if (!config) return;
        const buildConfig = config;
        config = undefined;
        if (scene === "honoReact") await this.honoReactDeploy(buildConfig);
        if (scene === "react") await this.reactDeploy(buildConfig);
      },
    };
  }

  private async honoReactDeploy(config: ResolvedConfig): Promise<void> {
    const port = this.portRequired(config.server.port);
    const projectPath = config.configFile ? path.dirname(config.configFile) : process.cwd();
    const buildPath = path.resolve(projectPath, "dist");
    if (!existsSync(buildPath)) throw new Error(`Node 构建目录不存在: ${buildPath}`);
    const deploymentPackage = await this.nodejs.deploymentPackageCreate(buildPath, projectPath);
    const entry = path.resolve(buildPath, deploymentPackage.name, "index.js");
    if (!existsSync(entry)) throw new Error(`Node 构建入口不存在: ${entry}`);
    const remotePath = this.remotePath(port);
    const processName = `vite-node-${port}`;
    await this.sftp.remoteDirectoryReplace(buildPath, `${remotePath}/dist`);
    await this.sftp.remoteTextUpload(
      deploymentPackage.content,
      `${remotePath}/package.json`,
    );
    await this.nodejs.dependenciesRemoteInstall(remotePath);
    await this.pm2.processIsRemoteRunning({
      name: processName,
      path: remotePath,
      command: `node dist/${deploymentPackage.name}/index.js`,
      port,
      environment: { HOST: "127.0.0.1", PORT: String(port) },
    });
    await this.sftp.remoteTextUpload("node", `${remotePath}/.extends-ssh-kind`);
    await this.nginx.proxyRouteIsRunning({
      name: `vite-${port}`,
      hostname: this.hostname(port),
      pathname: "/",
      upstreamPort: port,
    });
    await this.publicVerify(port, "/", true);
  }

  private async reactDeploy(config: ResolvedConfig): Promise<void> {
    const buildPath = path.resolve(config.root, config.build.outDir);
    if (!existsSync(buildPath)) throw new Error(`Vite 构建目录不存在: ${buildPath}`);
    const port = this.portRequired(config.server.port);
    const remotePath = this.remotePath(port);
    await this.sftp.remoteDirectoryReplace(buildPath, remotePath);
    await this.pm2.processRemoteClose(`vite-node-${port}`);
    await this.sftp.remoteTextUpload("static", `${remotePath}/.extends-ssh-kind`);
    await this.staticRoute(port, remotePath);
    await this.publicVerify(port);
  }

  private tunnelConfigure(server: ViteDevServer, port: number): void {
    const httpServer = server.httpServer;
    if (!httpServer) throw new Error("Vite 开发服务器没有 HTTP Server");
    let startPromise: Promise<void> | undefined;
    httpServer.once("listening", () => {
      const address = httpServer.address();
      startPromise = (async () => {
        if (!address || typeof address === "string" || address.port !== port) {
          throw new Error(`Vite 未按项目端口 ${port} 启动`);
        }
        await this.tunnelStart(port);
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
        await this.tunnelClose(port);
      })();
    });
  }

  private async tunnelStart(port: number): Promise<void> {
    const current = this.forwards.get(port);
    if (current) {
      await this.proxyRoute(port, (await current.isRunning()).remotePort);
      await this.publicVerify(port, "/__vite_ping");
      return;
    }
    const forward = this.forward.register({
      name: `vite-${port}`,
      local: { host: "127.0.0.1", port },
      remote: { host: "127.0.0.1", port: 0 },
    });
    const remotePort = (await forward.isRunning()).remotePort;
    this.forwards.set(port, forward);
    try {
      await this.proxyRoute(port, remotePort);
      await this.publicVerify(port, "/__vite_ping");
    } catch (error) {
      this.forwards.delete(port);
      await forward.close();
      await this.tunnelClose(port);
      throw error;
    }
  }

  private async tunnelClose(port: number): Promise<void> {
    const forward = this.forwards.get(port);
    if (forward) {
      this.forwards.delete(port);
      await forward.close();
    }
    const remotePath = this.remotePath(port);
    const kind = await this.sftp.remoteTextRead(`${remotePath}/.extends-ssh-kind`);
    if (kind === "static") await this.staticRoute(port, remotePath);
    if (kind === "node") await this.proxyRoute(port, port);
    if (!kind) {
      await this.nginx.routeClose({ name: `vite-${port}`, hostname: this.hostname(port) });
    }
  }

  private async staticRoute(port: number, remotePath: string): Promise<void> {
    await this.nginx.staticRouteIsRunning({
      name: `vite-${port}`,
      hostname: this.hostname(port),
      pathname: "/",
      root: remotePath,
      spaFallback: true,
    });
  }

  private async proxyRoute(port: number, upstreamPort: number): Promise<void> {
    await this.nginx.proxyRouteIsRunning({
      name: `vite-${port}`,
      hostname: this.hostname(port),
      pathname: "/",
      upstreamPort: this.portRequired(upstreamPort),
    });
  }

  private async publicVerify(
    port: number,
    pathname = "/",
    notFoundAllowed = false,
  ): Promise<void> {
    const url = `https://${this.hostname(port)}${pathname}`;
    const deadline = Date.now() + 15_000;
    let failure: unknown;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, {
          headers: pathname === "/__vite_ping" ? { Accept: "text/x-vite-ping" } : undefined,
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
  }

  private remotePath(port: number): string {
    return `${store.getState().public.remoteRoot}/vite-${this.portRequired(port)}`;
  }

  private hostname(port: number): string {
    return `vite-${this.portRequired(port)}.dev.${this.nginx.state.domain}`;
  }

  private portRequired(port: unknown): number {
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new TypeError(`Vite 端口必须是 1-65535 的整数: ${String(port)}`);
    }
    return port;
  }
}
