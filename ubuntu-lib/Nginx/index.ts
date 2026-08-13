import type Apt from "../Apt/index.ts";
import type Ssh from "../Ssh/index.ts";
import store from "../store.ts";

type ProxyRoute = {
  name: string;
  hostname: string;
  pathname: `/${string}`;
  upstreamPort: number;
};

type StaticRoute = {
  name: string;
  hostname: string;
  pathname: `/${string}`;
  root: string;
  spaFallback: boolean;
};

type Route = Pick<ProxyRoute, "name" | "hostname">;

export default abstract class Nginx {
  protected abstract readonly apt: Apt;
  protected abstract readonly ssh: Ssh;
  private remoteRunningPromise?: Promise<void>;

  public get state() {
    const domain = store.getState().public.domain.trim().toLowerCase();
    this.hostnameRequired(domain);
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
    const name = this.nameRequired(route.name);
    const hostname = this.hostnameRequired(route.hostname);
    const pathname = this.pathnameRequired(route.pathname);
    const upstreamPort = this.portRequired(route.upstreamPort);
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
    const name = this.nameRequired(route.name);
    const hostname = this.hostnameRequired(route.hostname);
    const pathname = this.pathnameRequired(route.pathname);
    const root = this.linuxAbsolutePathRequired(route.root);
    const fallback = route.spaFallback
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
    const name = this.nameRequired(route.name);
    const hostname = this.hostnameRequired(route.hostname);
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

  private nameRequired(name: string): string {
    const value = name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
      throw new TypeError(`Nginx 路由名称无效: ${name}`);
    }
    return value;
  }

  private hostnameRequired(hostname: string): string {
    const value = hostname.trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)) {
      throw new TypeError(`Nginx hostname 无效: ${hostname}`);
    }
    return value;
  }

  private pathnameRequired(pathname: string): `/${string}` {
    if (!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/.test(pathname)) {
      throw new TypeError(`Nginx pathname 无效: ${pathname}`);
    }
    return pathname as `/${string}`;
  }

  private linuxAbsolutePathRequired(root: string): string {
    if (!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/.test(root)) {
      throw new TypeError(`Nginx 静态目录必须是 Linux 绝对路径: ${root}`);
    }
    return root;
  }

  private portRequired(port: number): number {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new TypeError(`Nginx 上游端口必须是 1-65535 的整数: ${String(port)}`);
    }
    return port;
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
