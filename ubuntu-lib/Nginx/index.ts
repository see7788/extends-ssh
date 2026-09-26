import Base from "../public/Base.ts";
import { certificate } from "../certificate/index.ts";
import mcpserver from "mcpserver";
import { z } from "zod";
import { posix } from "node:path";
import store from "../store/index.ts";
import { ssh } from "../ssh/index.ts";

const devPortValidator = z.number().int().min(1).max(65_535);
const inputValidator = z.object({ port: devPortValidator }).strict();
const pathValidator = z.string().trim()
  .regex(/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/, "path 必须是 Linux 绝对路径")
  .refine(value => {
    const basename = posix.basename(value);
    const port = Number(basename);
    return String(port) === basename && Number.isInteger(port) && port >= 1 && port <= 65_535;
  }, "path 末段必须是 1-65535 的开发端口");
const makeInputValidator = z.object({
  port: devPortValidator.optional(),
  path: pathValidator.optional(),
}).strict().refine(input => (input.port === undefined) !== (input.path === undefined), "port 与 path 必须二选一");

type Current = {
  readonly subdomain: string;
  readonly host: string;
  readonly port: 443;
  readonly secure: true;
  hasRemote(): Promise<boolean>;
  close(): Promise<void>;
};
class Nginx extends Base<(port: number) => Promise<Current>> {
  readonly current = this.getRemote.bind(this);

  protected remoteIsRunning(): Promise<void> {
    return this.ensureRemoteIsRunning(async () => {
      await ssh.execute(`set -e
NGINX=/www/server/nginx/sbin/nginx
CONFIG=/www/server/nginx/conf/nginx.conf
test -x "$NGINX"
pgrep -f 'nginx: master process' >/dev/null
"$NGINX" -t -c "$CONFIG" >/dev/null
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true`);
    });
  }
  private async getRemote(port: number): Promise<Current> {
    await this.remoteIsRunning();
    if (!await this.hasRemote(port)) {
      return this.makeRemote(port);
    }
    return {
      subdomain: this.remoteDescription(port),
      host: this.remoteDescription(port),
      port: 443,
      secure: true,
      hasRemote: () => this.hasRemote(port),
      close: () => this.closeRemote(port),
    };
  };
  async hasRemote(port: number): Promise<boolean> {
    const subdomain = this.remoteDescription(port);
    const route = this.routePath(port);
    const result = await ssh.execute(`if [ -f ${this.shell(route)} ] \
  && grep -Fq -- ${this.shell(`server_name ${subdomain};`)} ${this.shell(route)} \
  && grep -Fq -- ${this.shell("listen 443 ssl;")} ${this.shell(route)}; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }
  async makeRemote(input: number | string): Promise<Current> {
    await this.remoteIsRunning();
    if (typeof input === "number") {
      const port = input;
      await this.writeRemote(port, `  location / { proxy_pass http://127.0.0.1:${port}; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }`);
      return {
        subdomain: this.remoteDescription(port),
        host: this.remoteDescription(port),
        port: 443,
        secure: true,
        hasRemote: () => this.hasRemote(port),
        close: () => this.closeRemote(port),
      };
    }
    const path = input;
    const basename = posix.basename(path);
    const port = Number(basename);
    await this.writeRemote(port, `  location / { root ${path}; index index.html; try_files $uri $uri/ =404; }`);
    return {
      subdomain: this.remoteDescription(port),
      host: this.remoteDescription(port),
      port: 443,
      secure: true,
      hasRemote: () => this.hasRemote(port),
      close: () => this.closeRemote(port),
    };
  }
  private async writeRemote(value: number, location: string): Promise<void> {
    const subdomain = this.remoteDescription(value);
    const route = this.routePath(value);
    const certificatePaths = await certificate.current(subdomain);
    await ssh.execute(`set -e
mkdir -p ${this.shell("/www/server/panel/vhost/nginx")}
cat > ${this.shell(route)} <<'NGINX'
server {
  listen 80;
  server_name ${subdomain};
  location / { return 301 https://$host$request_uri; }
}
server {
  listen 443 ssl;
  server_name ${subdomain};
  ssl_certificate ${certificatePaths.certPath};
  ssl_certificate_key ${certificatePaths.keyPath};
  ssl_protocols TLSv1.2 TLSv1.3;
${location}
}
NGINX
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf`);
  }
  async closeRemote(port: number): Promise<void> {
    await this.remoteIsRunning();
    await ssh.execute(`set -e
rm -f ${this.shell(this.routePath(port))}
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf`);
  }
  private routePath(port: number): string {
    return `/www/server/panel/vhost/nginx/extends-ssh-${port}.conf`;
  }
  private shell(value: string): string { return `'${value.replace(/'/g, `\'"'"'`)}'`; }
  private remoteDescription(port: number): string {
    return `${port}.${store.getState().domain}`;
  }
}

export const nginx = new Nginx();
export default mcpserver.metas("/nginx")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口或远程目录写入 HTTPS Nginx 路由；域名 DNS 需指向 SSH 主机。", schema: makeInputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const value = makeInputValidator.parse(input); const remote = await nginx.makeRemote(value.port ?? value.path!); return { subdomain: remote.subdomain }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口对应的 HTTPS Nginx 路由是否已写入。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await nginx.hasRemote(input.port) }) })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的 HTTPS Nginx 路由配置。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await nginx.current(input.port); return { subdomain: remote.subdomain }; } })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭开发端口对应的 HTTPS Nginx 路由。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await nginx.closeRemote(input.port); return { closed: true }; } });
