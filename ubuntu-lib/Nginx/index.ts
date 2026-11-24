import Base from "../public/index.ts";
import LetsEncrypt from "../letsencrypt/index.ts";
import { posix } from "node:path";
import Ssh from "../ssh/index.ts";

export default class extends Base {
  constructor(
    private readonly service: "sftp" | "pm2" | "forward",
    private readonly input: number | string,
  ) {
    super();
  }
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    const { binary, config } = this.envs.nginx;
    await ssh.execute(`set -e
NGINX=${ssh.quoteShellArg(binary)}
CONFIG=${ssh.quoteShellArg(config)}
test -x "$NGINX"
pgrep -f 'nginx: master process' >/dev/null
"$NGINX" -t -c "$CONFIG" >/dev/null
ufw allow ${this.envs.nginx.httpPort}/tcp >/dev/null 2>&1 || true
ufw allow ${this.envs.nginx.httpsPort}/tcp >/dev/null 2>&1 || true`);
  }
  async getRemote(): Promise<{ readonly url: string; hasRemote(): Promise<boolean>; close(): Promise<void>; }> {
    await this.setupReady();
    if (!await this.hasRemote()) {
      return this.makeRemote();
    }
    return {
      url: this.url,
      hasRemote: () => this.hasRemote(),
      close: () => this.closeRemote(),
    };
  }
  async hasRemote(): Promise<boolean> {
    await this.setupReady();
    const ssh = new Ssh();
    const subdomain = this.remoteDescription();
    const route = this.routePath();
    const result = await ssh.execute(`if [ -f ${ssh.quoteShellArg(route)} ] \
  && grep -Fq -- ${ssh.quoteShellArg(`server_name ${subdomain};`)} ${ssh.quoteShellArg(route)} \
  && grep -Fq -- ${ssh.quoteShellArg(`listen ${this.envs.nginx.httpsPort} ssl;`)} ${ssh.quoteShellArg(route)}; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }
  async makeRemote(): Promise<{ readonly url: string; hasRemote(): Promise<boolean>; close(): Promise<void>; }> {
    await this.setupReady();
    const location = typeof this.input === "number"
      ? `  location / { proxy_pass http://127.0.0.1:${this.input}; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }`
      : `  location / { root ${this.input}; index index.html; try_files $uri $uri/ =404; }`;
    const certificate = new LetsEncrypt();
    const ssh = new Ssh();
    const nginx = this.envs.nginx;
    const nginxRoot = nginx.root;
    const subdomain = this.remoteDescription();
    const route = this.routePath();
    const certificatePaths = await certificate.makeRemote(subdomain, nginx.binary, nginx.config);
    await ssh.execute(`set -e
mkdir -p ${ssh.quoteShellArg(nginxRoot)}
cat > ${ssh.quoteShellArg(route)} <<'NGINX'
server {
  listen ${nginx.httpPort};
  server_name ${subdomain};
  location / { return 301 https://$host$request_uri; }
}
server {
  listen ${nginx.httpsPort} ssl;
  server_name ${subdomain};
  ssl_certificate ${certificatePaths.certPath};
  ssl_certificate_key ${certificatePaths.keyPath};
  ssl_protocols ${nginx.tlsProtocols.join(" ")};
${location}
}
NGINX
${ssh.quoteShellArg(nginx.binary)} -t -c ${ssh.quoteShellArg(nginx.config)}
${ssh.quoteShellArg(nginx.binary)} -s reload -c ${ssh.quoteShellArg(nginx.config)}`);
    return {
      url: this.url,
      hasRemote: () => this.hasRemote(),
      close: () => this.closeRemote(),
    };
  }
  async closeRemote(): Promise<void> {
    await this.setupReady();
    const ssh = new Ssh();
    const { binary, config } = this.envs.nginx;
    await ssh.execute(`set -e
rm -f ${ssh.quoteShellArg(this.routePath())}
${ssh.quoteShellArg(binary)} -t -c ${ssh.quoteShellArg(config)}
${ssh.quoteShellArg(binary)} -s reload -c ${ssh.quoteShellArg(config)}`);
  }
  private get port(): number {
    return typeof this.input === "number" ? this.input : Number(posix.basename(this.input));
  }
  private routePath(): string {
    return `${this.envs.nginx.root}/extends-ssh-${this.service}-${this.port}.conf`;
  }
  private remoteDescription(): string {
    return `${this.port}.${this.service}.${this.domain}`;
  }
  get url(): string {
    return `https://${this.remoteDescription()}`;
  }
}
