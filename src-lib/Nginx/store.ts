import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import type { SSHExecCommandResponse } from "node-ssh";

type ProxyRoute = {
  name: string;
  hostname: string;
  pathname: string;
  upstreamPort: number;
};

type StaticRoute = {
  name: string;
  hostname: string;
  pathname: string;
  root: string;
  spaFallback: boolean;
};

type NginxSlice = {
  Nginx: {
    httpPort: 80;
    httpsPort: 443;
    secure: true;
  };
  NginxActions: {
    isRemoteRunning(): Promise<void>;
    proxyRouteIsRunning(route: ProxyRoute): Promise<void>;
    staticRouteIsRunning(route: StaticRoute): Promise<void>;
    routeClose(route: { name: string; hostname: string }): Promise<void>;
  };
};

type NginxDependencies = {
  Public: {
    domain: string;
  };
  AptActions: {
    isRemoteRunning(): Promise<void>;
  };
  SshActions: {
    execute(command: string): Promise<SSHExecCommandResponse>;
  };
};

const s: immerStateCreator<NginxSlice, NginxDependencies> = (_set, get) => {
  let running: Promise<void> | undefined;
  const shell = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
  const nameRequired = (name: string): string => {
    const value = name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
      throw new TypeError(`Nginx 路由名称无效: ${name}`);
    }
    return value;
  };
  const hostnameRequired = (hostname: string): string => {
    const value = hostname.trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)) {
      throw new TypeError(`Nginx hostname 无效: ${hostname}`);
    }
    return value;
  };
  const pathnameRequired = (pathname: string): string => {
    if (!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/.test(pathname)) {
      throw new TypeError(`Nginx pathname 无效: ${pathname}`);
    }
    return pathname;
  };
  const portRequired = (port: number): number => {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new TypeError(`Nginx 上游端口必须是 1-65535 的整数: ${String(port)}`);
    }
    return port;
  };
  const rootRequired = (root: string): string => {
    if (!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/.test(root)) {
      throw new TypeError(`Nginx 静态目录必须是 Linux 绝对路径: ${root}`);
    }
    return root;
  };
  const routeDirectory = (hostname: string) =>
    `/www/server/panel/vhost/nginx/extends-ssh-routes/${hostname}`;
  const routePath = (hostname: string, name: string) =>
    `${routeDirectory(hostname)}/${name}.conf`;
  const hostnamePath = (hostname: string) =>
    `/www/server/panel/vhost/nginx/extends-ssh-${hostname}.conf`;
  const legacyPath = (name: string) =>
    `/www/server/panel/vhost/nginx/extends-ssh-${name}.conf`;
  const isRemoteRunning = (): Promise<void> => {
    if (running) return running;
    const execution = (async () => {
      await get().AptActions.isRemoteRunning();
      await get().SshActions.execute(`
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
    })().finally(() => {
      if (running === execution) running = undefined;
    });
    running = execution;
    return execution;
  };
  const routeWrite = async (route: {
    name: string;
    hostname: string;
    configuration: string;
  }): Promise<void> => {
    await isRemoteRunning();
    const hostPath = hostnamePath(route.hostname);
    const directory = routeDirectory(route.hostname);
    await get().SshActions.execute(`
set -e
mkdir -p ${shell(directory)}
rm -f ${shell(legacyPath(route.name))}
cat > ${shell(routePath(route.hostname, route.name))} <<'ROUTE'
${route.configuration}
ROUTE
if [ ! -f ${shell(`/etc/letsencrypt/live/${route.hostname}/fullchain.pem`)} ]; then
  cat > ${shell(hostPath)} <<'HTTP'
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
cat > ${shell(hostPath)} <<'HTTPS'
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
  include ${directory}/*.conf;
}
HTTPS
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
`);
  };

  return {
    Nginx: {
      httpPort: 80,
      httpsPort: 443,
      secure: true,
    },
    NginxActions: {
      isRemoteRunning,
      async proxyRouteIsRunning(route) {
        const name = nameRequired(route.name);
        const hostname = hostnameRequired(route.hostname);
        const pathname = pathnameRequired(route.pathname);
        const upstreamPort = portRequired(route.upstreamPort);
        const proxy = `
    proxy_pass http://127.0.0.1:${upstreamPort};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";`;
        await routeWrite({
          name,
          hostname,
          configuration: pathname === "/"
            ? `  location / {${proxy}\n  }`
            : `  location = ${pathname} {${proxy}\n  }\n  location ^~ ${pathname}/ {${proxy}\n  }`,
        });
      },
      async staticRouteIsRunning(route) {
        const name = nameRequired(route.name);
        const hostname = hostnameRequired(route.hostname);
        const pathname = pathnameRequired(route.pathname);
        const root = rootRequired(route.root);
        const fallback = route.spaFallback
          ? pathname === "/" ? "/index.html" : `${pathname}/index.html`
          : "=404";
        await routeWrite({
          name,
          hostname,
          configuration: `  location ^~ ${pathname} {
    root ${root};
    try_files $uri $uri/ ${fallback};
  }`,
        });
      },
      async routeClose(route) {
        const name = nameRequired(route.name);
        const hostname = hostnameRequired(route.hostname);
        await isRemoteRunning();
        await get().SshActions.execute(`
set -e
rm -f ${shell(routePath(hostname, name))} ${shell(legacyPath(name))}
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
`);
      },
    },
  };
};

export default s;
