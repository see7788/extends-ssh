import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import fs, { existsSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";
import type { SSHExecCommandResponse } from "node-ssh";
import { init, parse } from "es-module-lexer";

type NodejsSlice = {
  Nodejs: {
    version: string;
    architecture: "linux-x64";
    sha256: string;
  };
  NodejsActions: {
    isRemoteRunning(): Promise<void>;
    deploymentPackageCreate(
      buildPath: string,
      projectPath: string,
    ): Promise<{ content: string; name: string }>;
    dependenciesRemoteInstall(projectPath: string): Promise<void>;
  };
};

type NodejsDependencies = {
  AptActions: {
    isRemoteRunning(): Promise<void>;
  };
  SshActions: {
    execute(command: string): Promise<SSHExecCommandResponse>;
  };
};

const s: immerStateCreator<NodejsSlice, NodejsDependencies> = (_set, get) => {
  let running: Promise<void> | undefined;
  const shell = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
  return {
    Nodejs: {
      version: "22.23.2",
      architecture: "linux-x64",
      sha256: "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307",
    },
    NodejsActions: {
      isRemoteRunning() {
        if (running) return running;
        const execution = (async () => {
          const { version, architecture, sha256 } = get().Nodejs;
          if (!/^\d+\.\d+\.\d+$/.test(version)) {
            throw new TypeError(`Node.js 版本无效: ${version}`);
          }
          if (!/^[a-f0-9]{64}$/.test(sha256)) {
            throw new TypeError(`Node.js SHA-256 无效: ${sha256}`);
          }
          await get().AptActions.isRemoteRunning();
          const archive = `node-v${version}-${architecture}.tar.xz`;
          const nodeRoot = `/opt/node-v${version}-${architecture}`;
          await get().SshActions.execute(`
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
        })().finally(() => {
          if (running === execution) running = undefined;
        });
        running = execution;
        return execution;
      },
      async deploymentPackageCreate(buildPath, projectPath) {
        const packagePath = path.resolve(projectPath, "package.json");
        if (!existsSync(packagePath)) {
          throw new Error(`Node 项目 package.json 不存在: ${packagePath}`);
        }
        const sourcePackage = JSON.parse(
          await fs.promises.readFile(packagePath, "utf8"),
        ) as {
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
          let searchPath = projectPath;
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
                const current = JSON.parse(
                  fs.readFileSync(candidate, "utf8"),
                ) as { name?: string };
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
        const files = await fs.promises.readdir(buildPath, { recursive: true });
        for (const file of files.filter(value => /\.[cm]?js$/.test(value))) {
          const source = await fs.promises.readFile(path.resolve(buildPath, file), "utf8");
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
          const dependency = JSON.parse(
            await fs.promises.readFile(dependencyPath, "utf8"),
          ) as {
            version?: string;
            peerDependencies?: Record<string, string>;
          };
          if (!dependency.version) {
            throw new Error(`无法确定 Node 外部依赖版本: ${name}`);
          }
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
      },
      async dependenciesRemoteInstall(projectPath) {
        await get().NodejsActions.isRemoteRunning();
        await get().SshActions.execute(`
set -e
cd ${shell(projectPath)}
npm install --omit=dev --no-package-lock
`);
      },
    },
  };
};

export default s;
