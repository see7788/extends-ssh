import Base from "../public/index.ts";
import Certificate from "../certificate/index.ts";
import { posix } from "node:path";
import Ssh from "../ssh/index.ts";
import store from "../store/index.ts";

type NginxService = "sftp" | "pm2" | "sshForward";

type NginxRoute = {
  readonly url: string;
  hasRemote(): Promise<boolean>;
  close(): Promise<void>;
};
export default class extends Base {
  constructor(private readonly service: NginxService) {
    super();
  }
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
      url: this.getUrl(port),
      hasRemote: () => this.hasRemote(port),
      close: () => this.closeRemote(port),
    };
  };
  async hasRemote(port: number): Promise<boolean> {
    const ssh = new Ssh();
    const subdomain = this.remoteDescription(port);
    const route = this.routePath(port);
    const result = await ssh.execute(`if [ -f ${ssh.quoteShellArg(route)} ] \
  && grep -Fq -- ${ssh.quoteShellArg(`server_name ${subdomain};`)} ${ssh.quoteShellArg(route)} \
  && grep -Fq -- ${ssh.quoteShellArg("listen 443 ssl;")} ${ssh.quoteShellArg(route)}; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }
  async makeRemote(input: number | `${string}/${number}`): Promise<NginxRoute> {
    await this.setupReady();
    const port = typeof input === "number" ? input : Number(posix.basename(input));
    const location = typeof input === "number"
      ? `  location / { proxy_pass http://127.0.0.1:${input}; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }`
      : `  location / { root ${input}; index index.html; try_files $uri $uri/ =404; }`;
    const certificate = new Certificate();
    const ssh = new Ssh();
    const root = store.getState().nginx.root;
    const subdomain = this.remoteDescription(input);
    const route = this.routePath(port);
    const certificatePaths = await certificate.makeRemote(subdomain);
    await ssh.execute(`set -e
mkdir -p ${ssh.quoteShellArg(root)}
cat > ${ssh.quoteShellArg(route)} <<'NGINX'
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
    return {
      url: this.getUrl(input),
      hasRemote: () => this.hasRemote(port),
      close: () => this.closeRemote(port),
    };
  }
  async closeRemote(port: number): Promise<void> {
    await this.setupReady();
    const ssh = new Ssh();
    await ssh.execute(`set -e
rm -f ${ssh.quoteShellArg(this.routePath(port))}
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf`);
  }
  private routePath(port: number): string {
    return `${store.getState().nginx.root}/extends-ssh-${this.service}-${port}.conf`;
  }
  private remoteDescription(input: number | `${string}/${number}`): string {
    const port = typeof input === "number" ? input : Number(posix.basename(input));
    return `${port}.${this.service}.${this.domain}`;
  }
  getUrl(input: number | `${string}/${number}`): string {
    return `https://${this.remoteDescription(input)}`;
  }
}
