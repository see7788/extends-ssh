import { apt } from "../Apt/index.ts";
import { emptyValidator, mcpRegister, mutate, read, type McpJsonContext } from "../mcpBase.ts";
import { ssh } from "../Ssh/index.ts";
import store from "../store/index.ts";
import { z } from "zod";

const nameValidator = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const hostnameValidator = z.string().trim().toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i);
const pathnameValidator = z.string().trim()
  .regex(/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/)
  .transform(pathname => pathname as `/${string}`);
const linuxAbsolutePathValidator = z.string().trim()
  .regex(/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/);
const portValidator = z.number().int().min(1).max(65_535);

export const proxyRouteIsRunningValidator = z.object({
  name: nameValidator,
  hostname: hostnameValidator,
  pathname: pathnameValidator,
  upstreamPort: portValidator,
}).strict();
export const staticRouteIsRunningValidator = z.object({
  name: nameValidator,
  hostname: hostnameValidator,
  pathname: pathnameValidator,
  root: linuxAbsolutePathValidator,
  spaFallback: z.boolean(),
}).strict();
export const routeCloseValidator = z.object({
  name: nameValidator,
  hostname: hostnameValidator,
}).strict();

export type ProxyRoute = z.infer<typeof proxyRouteIsRunningValidator>;
export type StaticRoute = z.infer<typeof staticRouteIsRunningValidator>;
export type Route = z.infer<typeof routeCloseValidator>;

export default class Nginx {
  protected readonly apt = apt;
  protected readonly ssh = ssh;
  private remoteRunningPromise?: Promise<void>;

  public get state() {
    const domain = hostnameValidator.parse(store.getState().public.domain);
    return {
      domain,
      httpPort: 80 as const,
      httpsPort: 443 as const,
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

  public async proxyRouteIsRunning(route: ProxyRoute): Promise<void> {
    const { name, hostname, pathname, upstreamPort } = proxyRouteIsRunningValidator.parse(route);
    const proxyConfiguration = `
    proxy_pass http://127.0.0.1:${upstreamPort};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";`;
    await this.routeWrite({
      name,
      hostname,
      configuration: pathname === "/"
        ? `  location / {${proxyConfiguration}
  }`
        : `  location = ${pathname} {${proxyConfiguration}
  }
  location ^~ ${pathname}/ {${proxyConfiguration}
  }`,
    });
  }

  public async staticRouteIsRunning(route: StaticRoute): Promise<void> {
    const { name, hostname, pathname, root, spaFallback } = staticRouteIsRunningValidator.parse(route);
    const fallback = spaFallback
      ? pathname === "/" ? "/index.html" : `${pathname}/index.html`
      : "=404";
    await this.routeWrite({
      name,
      hostname,
      configuration: `  location ^~ ${pathname} {
    root ${root};
    try_files $uri $uri/ ${fallback};
  }`,
    });
  }

  public async routeClose(route: Route): Promise<void> {
    const { name, hostname } = routeCloseValidator.parse(route);
    await this.isRemoteRunning();
    await this.ssh.execute(`
set -e
rm -f ${this.shell(this.routePath(hostname, name))} ${this.shell(this.legacyPath(name))}
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
`);
  }

  private async remoteRunningEnsure(): Promise<void> {
    await this.apt.isRemoteRunning();
    await this.ssh.execute(`
set -e
NGINX=/www/server/nginx/sbin/nginx
test -x "$NGINX"
pgrep -f 'nginx: master process' >/dev/null
mkdir -p /var/www/certbot /www/server/panel/vhost/nginx/extends-ssh-routes
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot >/dev/null
fi
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw reload >/dev/null
`);
  }

  private async routeWrite(route: {
    name: string;
    hostname: string;
    configuration: string;
  }): Promise<void> {
    await this.isRemoteRunning();
    const hostnamePath = this.hostnamePath(route.hostname);
    const routeDirectory = this.routeDirectory(route.hostname);
    await this.ssh.execute(`
set -e
mkdir -p ${this.shell(routeDirectory)}
rm -f ${this.shell(this.legacyPath(route.name))}
cat > ${this.shell(this.routePath(route.hostname, route.name))} <<'ROUTE'
${route.configuration}
ROUTE
if [ ! -f ${this.shell(`/etc/letsencrypt/live/${route.hostname}/fullchain.pem`)} ]; then
  cat > ${this.shell(hostnamePath)} <<'HTTP'
server {
  listen 80;
  server_name ${route.hostname};
  location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 404; }
}
HTTP
  /www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
  /www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
  certbot certonly --webroot -w /var/www/certbot -d ${route.hostname} \
    --non-interactive --agree-tos --register-unsafely-without-email
fi
cat > ${this.shell(hostnamePath)} <<'HTTPS'
server {
  listen 80;
  server_name ${route.hostname};
  location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 301 https://$host$request_uri; }
}
server {
  listen 443 ssl;
  server_name ${route.hostname};
  ssl_certificate /etc/letsencrypt/live/${route.hostname}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${route.hostname}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  include ${routeDirectory}/*.conf;
}
HTTPS
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
`);
  }

  private hostnamePath(hostname: string): string {
    return `/www/server/panel/vhost/nginx/extends-ssh-${hostname}.conf`;
  }

  private routeDirectory(hostname: string): string {
    return `/www/server/panel/vhost/nginx/extends-ssh-routes/${hostname}`;
  }

  private routePath(hostname: string, name: string): string {
    return `${this.routeDirectory(hostname)}/${name}.conf`;
  }

  private legacyPath(name: string): string {
    return `/www/server/panel/vhost/nginx/extends-ssh-${name}.conf`;
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }
}

export const nginx = new Nginx();

export const nginxSlice = mcpRegister.slice("nginx")
  .tool(
    "post",
    "/state",
    emptyValidator,
    "读取 Nginx 的公开访问状态。",
    read,
    (context: McpJsonContext<{}>) => context.json(nginx.state),
  )
  .tool(
    "post",
    "/ensure",
    emptyValidator,
    "检查远端 Nginx，缺少时完成安装与基础配置。",
    mutate,
    async (context: McpJsonContext<{}>) => {
      await nginx.isRemoteRunning();
      return context.json({ ready: true });
    },
  )
  .tool(
    "post",
    "/proxyRouteIsRunning",
    proxyRouteIsRunningValidator,
    "写入并启用指定域名、路径与目标端口的 Nginx 反向代理路由。",
    mutate,
    async (context: McpJsonContext<ProxyRoute>) => {
      await nginx.proxyRouteIsRunning(context.req.valid("json"));
      return context.json({ configured: true });
    },
  )
  .tool(
    "post",
    "/staticRouteIsRunning",
    staticRouteIsRunningValidator,
    "写入并启用指定域名、路径与静态目录的 Nginx 静态资源路由。",
    mutate,
    async (context: McpJsonContext<StaticRoute>) => {
      await nginx.staticRouteIsRunning(context.req.valid("json"));
      return context.json({ configured: true });
    },
  )
  .tool(
    "post",
    "/routeClose",
    routeCloseValidator,
    "关闭并移除指定名称与域名的 Nginx 路由。",
    mutate,
    async (context: McpJsonContext<Route>) => {
      await nginx.routeClose(context.req.valid("json"));
      return context.json({ closed: true });
    },
  );
