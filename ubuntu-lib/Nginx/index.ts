import Base from "../public/index.ts";
import Certificate from "../certificate/index.ts";
import { posix } from "node:path";
import Ssh from "../ssh/index.ts";

type NginxRoute = {
  readonly subdomain: string;
  readonly host: string;
  readonly port: 443;
  readonly secure: true;
  hasRemote(): Promise<boolean>;
  close(): Promise<void>;
};
export default class extends Base {
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute(`set -e
NGINX=/www/server/nginx/sbin/nginx
CONFIG=/www/server/nginx/conf/nginx.conf
test -x "$NGINX"
pgrep -f 'nginx: master process' >/dev/null
"$NGINX" -t -c "$CONFIG" >/dev/null
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true`);
  }
  async getRemote(port: number): Promise<NginxRoute> {
    await this.setupReady();
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
    const ssh = new Ssh();
    const subdomain = this.remoteDescription(port);
    const route = this.routePath(port);
    const result = await ssh.execute(`if [ -f ${this.shell(route)} ] \
  && grep -Fq -- ${this.shell(`server_name ${subdomain};`)} ${this.shell(route)} \
  && grep -Fq -- ${this.shell("listen 443 ssl;")} ${this.shell(route)}; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }
  async makeRemote(input: number | string): Promise<NginxRoute> {
    await this.setupReady();
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
    const certificate = new Certificate();
    const ssh = new Ssh();
    const subdomain = this.remoteDescription(value);
    const route = this.routePath(value);
    const certificatePaths = await certificate.makeRemote(subdomain);
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
    await this.setupReady();
    const ssh = new Ssh();
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
    return `${port}.${this.domain}`;
  }
}
