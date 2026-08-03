import fs, { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire, isBuiltin } from "node:module";
import compressing from "compressing";
import { init, parse } from "es-module-lexer";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import Public from "extends-ssh/Ubuntu/public.ts";
import store from "extends-ssh/Ubuntu/store.ts";

type Forward = {
  port: number;
  dispose(): Promise<void>;
};

export default class Vite {
  private readonly runtime = new Public();
  private readonly data = {
    forwards: new Map<number, Forward>(),
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
            allowedHosts: [`.dev.${store.getState().mainDomain}`],
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
        try {
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
              await this.runtime.ssh.putFile(deploymentPackage, `${remotePath}/package.json`);
              await this.runtime.pm2IsRunning();
              const processName = `vite-node-${port}`;
              const startResult = await this.runtime.execute(`
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
              await this.proxyRoute({ port, upstreamPort });
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
            await this.runtime.execute(`
pm2 delete ${this.shell(`vite-static-${port}`)} >/dev/null 2>&1 || true
pm2 delete ${this.shell(`vite-node-${port}`)} >/dev/null 2>&1 || true
pm2 save --force >/dev/null 2>&1 || true
`);
            await this.staticRoute({ port, remotePath });
            await this.publicVerify(port);
          }
        } finally {
          this.runtime.dispose();
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
      })().finally(() => this.runtime.dispose());
    });
  }

  private async tunnelStart(port: number): Promise<void> {
    const current = this.data.forwards.get(port);
    if (current) {
      await this.publicVerify(port, false, "/__vite_ping");
      return;
    }
    await this.connect();
    const forward = await this.runtime.ssh.forwardIn("127.0.0.1", 0, (_details, accept, reject) => {
      const localSocket = net.createConnection({ host: "127.0.0.1", port });
      const failed = () => {
        localSocket.destroy();
        reject();
      };
      localSocket.once("error", failed);
      localSocket.once("connect", () => {
        localSocket.off("error", failed);
        const channel = accept();
        localSocket.on("error", () => channel.destroy());
        channel.on("error", () => localSocket.destroy());
        channel.pipe(localSocket).pipe(channel);
      });
    });
    this.data.forwards.set(port, forward);
    try {
      await this.proxyRoute({ port, upstreamPort: forward.port });
      await this.publicVerify(port, false, "/__vite_ping");
    } catch (error) {
      this.data.forwards.delete(port);
      await forward.dispose();
      await this.tunnelClose(port);
      throw error;
    }
  }

  private async tunnelClose(port: number): Promise<void> {
    const forward = this.data.forwards.get(port);
    if (forward) {
      this.data.forwards.delete(port);
      await forward.dispose();
    }
    const remotePath = `${store.getState().vite.remoteRoot}/vite-${port}`;
    const kindPath = `${remotePath}/.extends-ssh-kind`;
    const kind = (await this.runtime.execute(
      `test -f ${this.shell(kindPath)} && cat ${this.shell(kindPath)} || true`,
    )).stdout.trim();
    if (kind === "static") await this.staticRoute({ port, remotePath });
    if (kind === "node") {
      const result = await this.runtime.execute(
        `cat ${this.shell(`${remotePath}/.extends-ssh-upstream-port`)}`,
      );
      const upstreamPort = this.portRequired(Number(result.stdout.trim()));
      await this.proxyRoute({ port, upstreamPort });
    }
    if (!kind) {
      await this.runtime.execute(`
rm -f ${this.shell(this.nginxPath(port))}
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
`);
    }
  }

  private async upload({ localPath, port, preserveDirectory = false }: {
    localPath: string;
    port: number;
    preserveDirectory?: boolean;
  }): Promise<string> {
    await this.connect();
    const remotePath = `${store.getState().vite.remoteRoot}/vite-${port}`;
    const remoteSource = preserveDirectory
      ? `${remotePath}/${path.basename(localPath)}`
      : remotePath;
    const remoteZip = `${remotePath}/site.zip`;
    const localZip = path.join(os.tmpdir(), `extends-ssh-${port}-${process.pid}.zip`);
    try {
      await compressing.zip.compressDir(localPath, localZip, { ignoreBase: true });
      await this.runtime.execute(
        `rm -rf ${this.shell(remotePath)} && mkdir -p ${this.shell(remoteSource)}`,
      );
      await this.runtime.ssh.putFile(localZip, remoteZip);
      const unzip = `unzip -oq ${this.shell(remoteZip)} -d ${this.shell(remoteSource)}`;
      await this.runtime.execute(`${unzip} && rm -f ${this.shell(remoteZip)}`);
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
    const hostname = this.hostname(port);
    const nginxPath = this.nginxPath(port);
    await this.nginxIsRunning();
    await this.runtime.execute(`
set -e
printf static > ${this.shell(`${remotePath}/.extends-ssh-kind`)}
cat > ${this.shell(nginxPath)} <<'CONFIG'
server {
  listen 80;
  server_name ${hostname};
  location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / {
    root ${remotePath};
    try_files $uri $uri/ /index.html;
  }
}
CONFIG
${this.certificateScript(hostname, nginxPath, `
  location / {
    root ${remotePath};
    try_files $uri $uri/ /index.html;
  }`)}
`);
  }

  private async proxyRoute(
    { port, upstreamPort }: { port: number; upstreamPort: number },
  ): Promise<void> {
    this.portRequired(upstreamPort);
    const hostname = this.hostname(port);
    const nginxPath = this.nginxPath(port);
    const location = `
  location / {
    proxy_pass http://127.0.0.1:${upstreamPort};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }`;
    await this.nginxIsRunning();
    await this.runtime.execute(`
set -e
cat > ${this.shell(nginxPath)} <<'CONFIG'
server {
  listen 80;
  server_name ${hostname};
  location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
${location}
}
CONFIG
${this.certificateScript(hostname, nginxPath, location)}
`);
  }

  private certificateScript(hostname: string, nginxPath: string, location: string): string {
    return `
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
if [ ! -f /etc/letsencrypt/live/${hostname}/fullchain.pem ]; then
  certbot certonly --webroot -w /var/www/certbot -d ${hostname} \\
    --non-interactive --agree-tos --register-unsafely-without-email
fi
cat > ${this.shell(nginxPath)} <<'CONFIG'
server {
  listen 80;
  server_name ${hostname};
  location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 301 https://$host$request_uri; }
}
server {
  listen 443 ssl;
  server_name ${hostname};
  ssl_certificate /etc/letsencrypt/live/${hostname}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${hostname}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
${location}
}
CONFIG
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf`;
  }

  private async nginxIsRunning(): Promise<void> {
    await this.connect();
    await this.runtime.execute(`
set -e
NGINX=/www/server/nginx/sbin/nginx
NGINX_CONFIG=/www/server/nginx/conf/nginx.conf
test -x "$NGINX"
pgrep -f 'nginx: master process' >/dev/null
mkdir -p /var/www/certbot /www/server/panel/vhost/nginx
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot >/dev/null
fi
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw reload >/dev/null
`);
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
    await this.runtime.sshIsRunning();
    await this.runtime.execute(`mkdir -p ${this.shell(store.getState().vite.remoteRoot)}`);
  }

  private portRequired(port: number): number {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`端口必须是 1-65535 的整数，收到 ${String(port)}`);
    }
    return port;
  }

  private hostname(port: number): string {
    const domain = store.getState().mainDomain;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
      throw new Error(`mainDomain 不是有效域名: ${domain}`);
    }
    return `vite-${this.portRequired(port)}.dev.${domain}`;
  }

  private nginxPath(port: number): string {
    return `/www/server/panel/vhost/nginx/extends-ssh-vite-${this.portRequired(port)}.conf`;
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

}
