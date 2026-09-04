import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Plugin, ResolvedConfig } from "vite";
import { z } from "zod";
import { forward } from "../Forward/index.ts";
import mcpserver from "mcpserver";
import {
  mutate,
  read,
  type McpJsonContext,
  type McpResourceContext,
} from "../mcpBase.ts";
import { nginx } from "../Nginx/index.ts";
import { nodejs } from "../Nodejs/index.ts";
import { pm2 } from "../Pm2/index.ts";
import { sftp } from "../Sftp/index.ts";

const projectPathValidator = z.string().trim().min(1).refine(path.isAbsolute, {
  message: "projectPath 必须是绝对路径",
});
export const projectReadValidator = z.object({
  projectPath: projectPathValidator,
}).strict();
export const dependenciesInstallValidator = projectReadValidator;
export const importsEnsureValidator = z.object({
  projectPath: projectPathValidator,
  sourceFilePath: z.string().trim().min(1).refine(path.isAbsolute, {
    message: "sourceFilePath 必须是绝对路径",
  }),
}).strict();
export const stateValidator = z.object({
  port: z.number().int().min(1).max(65535),
}).strict();
export type ProjectRead = z.infer<typeof projectReadValidator>;
export type DependenciesInstall = z.infer<typeof dependenciesInstallValidator>;
export type ImportsEnsure = z.infer<typeof importsEnsureValidator>;
export type State = z.infer<typeof stateValidator>;

const dependencyMapValidator = z.record(z.string(), z.string());
const projectPackageValidator = z.object({
  name: z.string().trim().min(1),
  tpltype: z.enum([
    "node-application",
    "hono-application",
    "electron-vite-application",
  ]).optional(),
  dependencies: dependencyMapValidator.optional(),
  devDependencies: dependencyMapValidator.optional(),
  optionalDependencies: dependencyMapValidator.optional(),
  peerDependencies: dependencyMapValidator.optional(),
  workspaces: z.unknown().optional(),
}).passthrough();

const dependencyPatch = {
  devDependencies: {
    "ubuntu-lib": "workspace:*",
    vite: "^8.0.11",
  },
} as const;
const ubuntuImport = 'import ubuntu from "ubuntu-lib/index.ts";';
const applicableExpressions = {
  node: ["ubuntu.vite.pro.nodejs()"],
  hono: ["ubuntu.vite.dev.forward()", "ubuntu.vite.pro.nodejs()"],
  "electron-vite": ["ubuntu.vite.dev.forward()"],
} as const satisfies Record<"node" | "hono" | "electron-vite", readonly string[]>;
export default class Vite {
  protected readonly forward = forward;
  protected readonly nginx = nginx;
  protected readonly nodejs = nodejs;
  protected readonly pm2 = pm2;
  protected readonly sftp = sftp;

  private missingPath(error: unknown): boolean {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (
        (error as { code?: unknown }).code === "ENOENT"
        || (error as { code?: unknown }).code === "ENOTDIR"
      );
  }

  private async existingFile(value: string): Promise<boolean> {
    try {
      return (await stat(value)).isFile();
    } catch (error) {
      if (this.missingPath(error)) return false;
      throw error;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async pnpmInstall(projectPath: string): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      let executable = "pnpm";
      if (process.platform === "win32") {
        const comSpec = process.env.ComSpec;
        if (comSpec === undefined) {
          rejectPromise(new Error("Windows 环境缺少 ComSpec。"));
          return;
        }
        executable = comSpec;
      }
      const args = process.platform === "win32"
        ? ["/d", "/s", "/c", "pnpm", "install"]
        : ["install"];
      execFile(
        executable,
        args,
        {
          cwd: projectPath,
          encoding: "utf8",
          maxBuffer: 5 * 1024 * 1024,
          timeout: 120_000,
          windowsHide: true,
        },
        error => {
          if (error) {
            rejectPromise(new Error(`pnpm install 失败：${error.message}`));
            return;
          }
          resolvePromise();
        },
      );
    });
  }

  private sourceInsideProject(projectPath: string, sourceFilePath: string): boolean {
    const value = path.relative(projectPath, sourceFilePath);
    return value.length > 0
      && value !== ".."
      && !value.startsWith(`..${path.sep}`)
      && !path.isAbsolute(value);
  }

  private async importEnsure(sourceFilePath: string): Promise<boolean> {
    const original = await readFile(sourceFilePath, "utf8");
    if (original.includes(ubuntuImport)) return false;
    const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
    const source = bom ? original.slice(1) : original;
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const shebangEnd = source.startsWith("#!") ? source.indexOf("\n") + 1 : 0;
    await writeFile(
      sourceFilePath,
      `${bom}${source.slice(0, shebangEnd)}${ubuntuImport}${newline}${source.slice(shebangEnd)}`,
      "utf8",
    );
    return true;
  }

  private async canonicalProjectPath(projectPath: string): Promise<string> {
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(projectPath);
    } catch (error) {
      if (this.missingPath(error)) throw new Error(`projectPath 不存在：${projectPath}`);
      throw error;
    }
    if (!(await stat(canonicalPath)).isDirectory()) {
      throw new Error(`projectPath 必须指向目录：${canonicalPath}`);
    }
    return canonicalPath;
  }

  private projectProfileDetect(
    tpltype: z.infer<typeof projectPackageValidator>["tpltype"],
    dependencyNames: ReadonlySet<string>,
    viteConfigExists: boolean,
    electronViteConfigExists: boolean,
  ): keyof typeof applicableExpressions {
    if (tpltype === "electron-vite-application") {
      if (!electronViteConfigExists || viteConfigExists) {
        throw new Error("electron-vite-application 只能使用 electron.vite.config.ts");
      }
      if (!dependencyNames.has("electron-vite")) {
        throw new Error("使用 electron.vite.config.ts 的项目必须声明 electron-vite 依赖");
      }
      return "electron-vite";
    }
    if (!viteConfigExists || electronViteConfigExists) {
      throw new Error(`${String(tpltype)} 只能使用 vite.config.ts`);
    }
    if (tpltype === "hono-application") {
      if (!dependencyNames.has("hono")) {
        throw new Error("hono-application 必须声明 hono 依赖");
      }
      return "hono";
    }
    if (tpltype === "node-application") return "node";
    throw new Error(`Ubuntu Vite 工具不支持该 tpltype：${String(tpltype)}`);
  }

  private portRequired(port: number) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new RangeError(`Vite 端口必须是 1-65535 的整数: ${String(port)}`);
    }
    return port;
  }

  private targetResolve(port: number) {
    const targetPort = this.portRequired(port);
    const name = `vite-${targetPort}`;
    const remotePath = this.sftp.remotePath(name);
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
        if (options !== undefined && options.accept !== undefined) {
          request.headers = { Accept: options.accept };
        }
        const response = await fetch(url, request);
        const isNotFoundAccepted = options !== undefined
          && options.isNotFoundAccepted === true;
        if (
          response.status < 400 ||
          (isNotFoundAccepted && response.status === 404)
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

  public async projectRead(input: ProjectRead) {
    const value = projectReadValidator.parse(input);
    const canonicalPath = await this.canonicalProjectPath(value.projectPath);
    const packagePath = path.join(canonicalPath, "package.json");
    const viteConfigPath = path.join(canonicalPath, "vite.config.ts");
    const electronViteConfigPath = path.join(canonicalPath, "electron.vite.config.ts");
    const [
      packageExists,
      viteConfigExists,
      electronViteConfigExists,
      pnpmWorkspaceExists,
      pnpmWorkspaceYmlExists,
    ] = await Promise.all([
      this.existingFile(packagePath),
      this.existingFile(viteConfigPath),
      this.existingFile(electronViteConfigPath),
      this.existingFile(path.join(canonicalPath, "pnpm-workspace.yaml")),
      this.existingFile(path.join(canonicalPath, "pnpm-workspace.yml")),
    ]);
    if (!packageExists) {
      throw new Error(`具体包缺少 package.json：${canonicalPath}`);
    }

    let packageJson: z.infer<typeof projectPackageValidator>;
    try {
      packageJson = projectPackageValidator.parse(
        JSON.parse(await readFile(packagePath, "utf8")),
      );
    } catch (error) {
      throw new Error(`具体包的 package.json 无效：${packagePath}`, { cause: error });
    }
    if (packageJson.name.startsWith("extends-") || packageJson.name.endsWith("-lib")) {
      throw new Error(`Ubuntu Vite 工具只适用于 application 包：${packageJson.name}`);
    }
    if (
      packageJson.workspaces !== undefined
      || pnpmWorkspaceExists
      || pnpmWorkspaceYmlExists
    ) {
      throw new Error(`workspace 根不是具体包：${canonicalPath}`);
    }

    const dependencyNames = new Set<string>();
    for (const dependencies of [
      packageJson.dependencies,
      packageJson.devDependencies,
      packageJson.optionalDependencies,
      packageJson.peerDependencies,
    ]) {
      if (dependencies === undefined) continue;
      for (const name of Object.keys(dependencies)) dependencyNames.add(name);
    }
    if (!dependencyNames.has("ubuntu-lib")) {
      throw new Error(`具体包必须声明 ubuntu-lib：${packagePath}`);
    }

    const profile = this.projectProfileDetect(
      packageJson.tpltype,
      dependencyNames,
      viteConfigExists,
      electronViteConfigExists,
    );
    const configPath = profile === "electron-vite"
      ? electronViteConfigPath
      : viteConfigPath;
    return {
      project: { name: packageJson.name, path: canonicalPath, profile },
      config: { path: configPath, uri: pathToFileURL(configPath).href },
      usage: {
        importPath: "ubuntu-lib/index.ts",
        importStatement: ubuntuImport,
        expressions: applicableExpressions[profile],
      },
      constraints: [
        "server.port 必须是 1 到 65535 之间的固定整数，不得动态计算。",
      ],
    };
  }

  public async dependenciesInstall(input: DependenciesInstall) {
    try {
      const value = dependenciesInstallValidator.parse(input);
      const projectPath = await this.canonicalProjectPath(value.projectPath);
      if (await this.existingFile(path.join(projectPath, "pnpm-workspace.yaml"))) {
        throw new Error(`projectPath 必须指向具体包，不能指向 pnpm workspace 根：${projectPath}`);
      }
      const packageJsonPath = path.join(projectPath, "package.json");
      if (!(await this.existingFile(packageJsonPath))) {
        throw new Error(`项目缺少 package.json：${packageJsonPath}`);
      }
      const packageJson = projectPackageValidator.parse(
        JSON.parse(await readFile(packageJsonPath, "utf8")),
      );
      const devDependencies = packageJson.devDependencies === undefined
        ? {}
        : packageJson.devDependencies;
      const next = {
        ...packageJson,
        devDependencies: {
          ...devDependencies,
          ...dependencyPatch.devDependencies,
        },
      };
      const changed = JSON.stringify(next) !== JSON.stringify(packageJson);
      if (changed) {
        await writeFile(packageJsonPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      }
      await this.pnpmInstall(projectPath);
      return {
        changed,
        installed: dependencyPatch,
        packageJsonPath,
        projectPath,
      };
    } catch (error) {
      throw new Error(this.errorMessage(error), { cause: error });
    }
  }

  public async importsEnsure(input: ImportsEnsure) {
    try {
      const value = importsEnsureValidator.parse(input);
      const projectPath = await this.canonicalProjectPath(value.projectPath);
      const sourceFilePath = await realpath(path.resolve(value.sourceFilePath));
      if (!this.sourceInsideProject(projectPath, sourceFilePath)) {
        throw new Error(`sourceFilePath 必须位于 projectPath 内部：${sourceFilePath}`);
      }
      if (
        !(await stat(sourceFilePath)).isFile()
        || path.extname(sourceFilePath).toLowerCase() !== ".ts"
      ) {
        throw new Error(`sourceFilePath 必须指向已经存在的 .ts 文件：${sourceFilePath}`);
      }
      if (sourceFilePath.toLowerCase().endsWith(".d.ts")) {
        throw new Error(`不支持修改声明文件：${sourceFilePath}`);
      }
      return {
        added: await this.importEnsure(sourceFilePath) ? [ubuntuImport] : [],
        projectPath,
        sourceFilePath,
      };
    } catch (error) {
      throw new Error(this.errorMessage(error), { cause: error });
    }
  }

  public state(port: State["port"]) {
    const input = stateValidator.parse({ port });
    const target = this.targetResolve(input.port);
    return { host: target.hostname, port: 443 as const, secure: true as const };
  }

  public readonly dev = {
    forward: (): Plugin => {
      let configuredPort: number | undefined;
      let registeredForward: ReturnType<typeof forward.register> | undefined;
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
            let detail: string;
            if (error instanceof Error) {
              detail = error.stack === undefined ? error.message : error.stack;
            } else {
              detail = String(error);
            }
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
                const productionKindText = await this.sftp.remoteTextRead(target.kindPath);
                const productionKind = productionKindText === undefined
                  ? undefined
                  : productionKindText.trim();
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
          const projectPath = config.configFile === undefined
            ? process.cwd()
            : path.dirname(config.configFile);
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

export const vite = new Vite();

const readmeUri = new URL("../README.md", import.meta.url).href;
const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));

export const viteSlice = mcpserver.metas("vite")
  .resource(
    "get",
    "/readme",
    readmeUri,
    {
      title: "项目 README",
      description: "读取 Ubuntu Vite 项目接入说明。",
      mimeType: "text/markdown",
    },
    async (context: McpResourceContext) => context.json({
      contents: [{
        uri: readmeUri,
        mimeType: "text/markdown",
        text: await readFile(readmePath, "utf8"),
      }],
    }),
  )
  .tool(
    "post",
    "/projectRead",
    projectReadValidator,
    "识别 Vite 项目类型并返回 Ubuntu 接入信息。",
    read,
    async (context: McpJsonContext<ProjectRead>) => {
      try {
        const result = await vite.projectRead(context.req.valid("json"));
        return context.json({
          ...result,
          blackbox: {
            resourceName: "vite.readme",
            path: readmePath,
            uri: readmeUri,
            instruction: "在组合下方公开表达式之前，必须先读取 vite.readme MCP 资源。",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return context.json({ error: message }, 400);
      }
    },
  )
  .tool(
    "post",
    "/dependenciesInstall",
    dependenciesInstallValidator,
    "补齐 Ubuntu Vite 依赖并执行 pnpm install。",
    mutate,
    async (context: McpJsonContext<DependenciesInstall>) => {
      try {
        return context.json(await vite.dependenciesInstall(context.req.valid("json")));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return context.json({ error: message }, 400);
      }
    },
  )
  .tool(
    "post",
    "/importsEnsure",
    importsEnsureValidator,
    "向项目 TypeScript 文件补充 Ubuntu 导入。",
    mutate,
    async (context: McpJsonContext<ImportsEnsure>) => {
      try {
        return context.json(await vite.importsEnsure(context.req.valid("json")));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return context.json({ error: message }, 400);
      }
    },
  )
  .tool(
    "post",
    "/state",
    stateValidator,
    "根据 Vite 端口返回公开 HTTPS 访问状态。",
    read,
    (context: McpJsonContext<State>) => context.json(
      vite.state(context.req.valid("json").port),
    ),
  );
