import fs, { existsSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";
import { init, parse } from "es-module-lexer";
import { apt } from "../Apt/index.ts";
import { emptyValidator, mcpRegister, mutate, read, type McpJsonContext } from "../mcpBase.ts";
import { sftp } from "../Sftp/index.ts";
import { ssh } from "../Ssh/index.ts";
import { z } from "zod";

const localPathValidator = z.string().trim().min(1).refine(path.isAbsolute, {
  message: "本地路径必须是绝对路径",
});
const remotePathValidator = z.string().trim().min(1);

export const deploymentPackageCreateValidator = z.object({
  buildPath: localPathValidator,
  projectPath: localPathValidator,
}).strict();
export const dependenciesRemoteInstallValidator = z.object({
  projectPath: remotePathValidator,
}).strict();

export type DeploymentPackageCreate = z.infer<typeof deploymentPackageCreateValidator>;
export type DependenciesRemoteInstall = z.infer<typeof dependenciesRemoteInstallValidator>;

export default class Nodejs {
  protected readonly apt = apt;
  protected readonly sftp = sftp;
  protected readonly ssh = ssh;
  private readonly configuration = {
    version: "22.23.2",
    architecture: "linux-x64",
    sha256: "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307",
  } as const;
  private remoteRunningPromise?: Promise<void>;

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

  /** 根据 Node 构建产物生成远端安装使用的 package.json。 */
  public async deploymentPackageCreate(
    buildPath: DeploymentPackageCreate["buildPath"],
    projectPath: DeploymentPackageCreate["projectPath"],
  ): Promise<{ content: string; name: string }> {
    const input = deploymentPackageCreateValidator.parse({ buildPath, projectPath });
    const packagePath = path.resolve(input.projectPath, "package.json");
    if (!existsSync(packagePath)) throw new Error(`Node 项目 package.json 不存在: ${packagePath}`);
    const sourcePackage = JSON.parse(await fs.promises.readFile(packagePath, "utf8")) as {
      name?: string;
      type?: string;
      dependencies?: Record<string, string>;
    };
    if (!sourcePackage.name || !/^[A-Za-z0-9._~-]+$/.test(sourcePackage.name)) {
      throw new TypeError(
        `Node 项目 package.json name 不是单一路径名称: ${String(sourcePackage.name)}`,
      );
    }
    const dependencies: Record<string, string> = {};
    const require = createRequire(packagePath);
    const packageResolve = (name: string): string | undefined => {
      let searchPath = input.projectPath;
      while (true) {
        const candidate = path.join(searchPath, "node_modules", name, "package.json");
        if (existsSync(candidate)) return candidate;
        const parentPath = path.dirname(searchPath);
        if (parentPath === searchPath) break;
        searchPath = parentPath;
      }
      try {
        let packageDirectory = path.dirname(require.resolve(name));
        while (path.dirname(packageDirectory) !== packageDirectory) {
          const candidate = path.join(packageDirectory, "package.json");
          if (existsSync(candidate)) {
            const current = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: string };
            if (current.name === name) return candidate;
          }
          packageDirectory = path.dirname(packageDirectory);
        }
      } catch {
        return;
      }
    };
    const externalPackages = new Set<string>();
    await init;
    const files = await fs.promises.readdir(input.buildPath, { recursive: true });
    for (const file of files.filter(value => /\.[cm]?js$/.test(value))) {
      const source = await fs.promises.readFile(path.resolve(input.buildPath, file), "utf8");
      for (const importEntry of parse(source)[0]) {
        const specifier = importEntry.n;
        if (
          !specifier
          || specifier.startsWith(".")
          || specifier.startsWith("/")
          || specifier.startsWith("#")
          || isBuiltin(specifier)
        ) continue;
        externalPackages.add(specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0]);
      }
    }
    const packageNames = Array.from(externalPackages);
    for (let packageIndex = 0; packageIndex < packageNames.length; packageIndex += 1) {
      const name = packageNames[packageIndex];
      const configuredVersion = sourcePackage.dependencies?.[name];
      if (configuredVersion?.startsWith("workspace:")) {
        throw new Error(`Node 构建产物仍依赖 workspace 包 ${name}`);
      }
      const dependencyPath = packageResolve(name);
      if (!dependencyPath) throw new Error(`无法定位 Node 外部依赖: ${name}`);
      const dependency = JSON.parse(await fs.promises.readFile(dependencyPath, "utf8")) as {
        version?: string;
        peerDependencies?: Record<string, string>;
      };
      if (!dependency.version) throw new Error(`无法确定 Node 外部依赖版本: ${name}`);
      dependencies[name] = configuredVersion ?? dependency.version;
      for (const peerName of Object.keys(dependency.peerDependencies ?? {})) {
        if (packageResolve(peerName) && !externalPackages.has(peerName)) {
          externalPackages.add(peerName);
          packageNames.push(peerName);
        }
      }
    }
    return {
      content: `${JSON.stringify({
        name: sourcePackage.name,
        private: true,
        type: sourcePackage.type ?? "module",
        dependencies,
      }, null, 2)}\n`,
      name: sourcePackage.name,
    };
  }

  /** 在远端 Node 项目中安装生产依赖。 */
  public async dependenciesRemoteInstall(
    projectPath: DependenciesRemoteInstall["projectPath"],
  ): Promise<void> {
    const input = dependenciesRemoteInstallValidator.parse({ projectPath });
    await this.isRemoteRunning();
    await this.sftp.remoteExecute(`
set -e
cd ${this.shell(input.projectPath)}
npm install --omit=dev --no-package-lock
`);
  }

  private async remoteRunningEnsure(): Promise<void> {
    const { version, architecture, sha256 } = this.configuration;
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new TypeError(`Node.js 版本无效: ${version}`);
    }
    if (architecture !== "linux-x64") {
      throw new TypeError(`Node.js 架构无效: ${architecture}`);
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new TypeError(`Node.js SHA-256 无效: ${sha256}`);
    }
    await this.apt.isRemoteRunning();
    const archive = `node-v${version}-${architecture}.tar.xz`;
    const nodeRoot = `/opt/node-v${version}-${architecture}`;
    await this.ssh.execute(`
set -e
NODE_VERSION=${version}
NODE_ARCHIVE=${archive}
NODE_ROOT=${nodeRoot}
if [ ! -x "$NODE_ROOT/bin/node" ]; then
  cd /tmp
  rm -f "$NODE_ARCHIVE"
  curl -fL --connect-timeout 15 --max-time 180 --retry 2 -o "$NODE_ARCHIVE" \
    "https://npmmirror.com/mirrors/node/v$NODE_VERSION/$NODE_ARCHIVE" || \
  curl -fL --connect-timeout 15 --max-time 180 --retry 2 -o "$NODE_ARCHIVE" \
    "https://nodejs.org/download/release/v$NODE_VERSION/$NODE_ARCHIVE"
  printf '%s  %s\n' ${sha256} "$NODE_ARCHIVE" | sha256sum -c -
  rm -rf "$NODE_ROOT"
  tar -xJf "$NODE_ARCHIVE" -C /opt
  rm -f "$NODE_ARCHIVE"
fi
for COMMAND in node npm npx corepack; do
  test -x "$NODE_ROOT/bin/$COMMAND"
  ln -sfn "$NODE_ROOT/bin/$COMMAND" "/usr/local/bin/$COMMAND"
done
/usr/local/bin/node -e "if (process.versions.node !== '$NODE_VERSION') process.exit(1)"
/usr/local/bin/npm --version >/dev/null
`);
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }
}

export const nodejs = new Nodejs();

export const nodejsSlice = mcpRegister.slice("nodejs")
  .tool(
    "post",
    "/ensure",
    emptyValidator,
    "检查远端 Node.js，缺少时完成安装并验证可用性。",
    mutate,
    async (context: McpJsonContext<{}>) => {
      await nodejs.isRemoteRunning();
      return context.json({ ready: true });
    },
  )
  .tool(
    "post",
    "/deploymentPackageCreate",
    deploymentPackageCreateValidator,
    "根据本地构建产物生成远端安装使用的生产 package.json。",
    read,
    async (context: McpJsonContext<DeploymentPackageCreate>) => {
      const { buildPath, projectPath } = context.req.valid("json");
      return context.json(await nodejs.deploymentPackageCreate(buildPath, projectPath));
    },
  )
  .tool(
    "post",
    "/dependenciesRemoteInstall",
    dependenciesRemoteInstallValidator,
    "在指定的远端 Node.js 项目目录安装生产依赖。",
    mutate,
    async (context: McpJsonContext<DependenciesRemoteInstall>) => {
      await nodejs.dependenciesRemoteInstall(context.req.valid("json").projectPath);
      return context.json({ installed: true });
    },
  );
