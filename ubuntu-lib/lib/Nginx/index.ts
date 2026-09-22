import Base from "../public/Base.ts";
import { certificate } from "../certificate/index.ts";
import mcpserver from "mcpserver";
import { z } from "zod";
import { posix } from "node:path";
import store from "../store/index.ts";
import { ssh } from "../ssh/index.ts";

const devPortValidator = z.number().int().min(1).max(65_535);
const inputValidator = z.object({ port: devPortValidator }).strict();
const pathValidator = z.string().trim().regex(/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/, "path 必须是 Linux 绝对路径");
const pathInputValidator = z.object({ path: pathValidator }).strict();
type Remote = {
  readonly subdomain: string;
  hasRemote(): Promise<boolean>;
  close(): Promise<void>;
};

class Nginx extends Base {
  protected async remoteIsRunning(): Promise<void> {
    await ssh.execute("set -e; command -v nginx >/dev/null 2>&1 || apt-get install -y -qq --no-install-recommends nginx >/dev/null; systemctl enable nginx --now >/dev/null; ufw allow 80/tcp >/dev/null 2>&1 || true; ufw allow 443/tcp >/dev/null 2>&1 || true; nginx -t");
  }
  async getRemote(port: number): Promise<Remote> {
    if (!await this.hasRemote(port)) {
      throw new Error(`开发端口尚未分配 Nginx 远程路由: ${port}`);
    }
    return this.remote(port);
  }
  async hasRemote(port: number): Promise<boolean> {
    const subdomain = this.remoteDescription(port);
    const configPath = `/etc/nginx/sites-enabled/extends-ssh-${port}`;
    await ssh.execute("true");
    const result = await ssh.execute(`if [ -f ${this.shell(configPath)} ] \
  && grep -Fq -- ${this.shell(`server_name ${subdomain};`)} ${this.shell(configPath)} \
  && grep -Fq -- ${this.shell("listen 443 ssl;")} ${this.shell(configPath)}; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }
  async makePortRemote(port: number): Promise<Remote> {
    await this.remoteIsRunning();
    await this.writeRemote(port, `  location / { proxy_pass http://127.0.0.1:${port}; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }`);
    return this.remote(port);
  }
  async makePathRemote(path: string): Promise<Remote> {
    const value = pathValidator.parse(path);
    const basename = posix.basename(value);
    const port = Number(basename);
    if (String(port) !== basename) throw new Error(`远程路径末段必须是开发端口: ${value}`);
    const validPort = devPortValidator.parse(port);
    await this.remoteIsRunning();
    await this.writeRemote(validPort, `  location / { root ${value}; index index.html; try_files $uri $uri/ =404; }`);
    return this.remote(validPort);
  }
  private async writeRemote(value: number, location: string): Promise<void> {
    const subdomain = this.remoteDescription(value);
    const certificatePaths = await certificate.ensure(subdomain);
    await ssh.execute(`set -e
cat > /etc/nginx/sites-available/extends-ssh-${value} <<'NGINX'
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
ln -sfn /etc/nginx/sites-available/extends-ssh-${value} /etc/nginx/sites-enabled/extends-ssh-${value}
nginx -t
systemctl reload nginx`);
  }
  async closeRemote(port: number): Promise<void> {
    await this.remoteIsRunning();
    await ssh.execute(`rm -f /etc/nginx/sites-enabled/extends-ssh-${port} /etc/nginx/sites-available/extends-ssh-${port}; nginx -t && systemctl reload nginx`);
  }
  private remote(port: number): Remote {
    return {
      subdomain: this.remoteDescription(port),
      hasRemote: () => this.hasRemote(port),
      close: () => this.closeRemote(port),
    };
  }

  private shell(value: string): string { return `'${value.replace(/'/g, `\'"'"'`)}'`; }
  private remoteDescription(port: number): string {
    return `${port}.${store.getState().domain}`;
  }
}

export const nginx = new Nginx();
export default mcpserver.metas("/nginx")
  .add({ protocol: "tool", path: "/makePortRemote", description: "按开发端口写入 HTTPS Nginx 端口反向代理路由；域名 DNS 需指向 SSH 主机。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await nginx.makePortRemote(input.port); return { subdomain: remote.subdomain }; } })
  .add({ protocol: "tool", path: "/makePathRemote", description: "按远程目录末段的开发端口写入 HTTPS Nginx 静态路由；域名 DNS 需指向 SSH 主机。", schema: pathInputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await nginx.makePathRemote(input.path); return { subdomain: remote.subdomain }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口对应的 HTTPS Nginx 路由是否已写入。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await nginx.hasRemote(input.port) }) })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的 HTTPS Nginx 路由配置。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await nginx.getRemote(input.port); return { subdomain: remote.subdomain }; } })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭开发端口对应的 HTTPS Nginx 路由。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await nginx.closeRemote(input.port); return { closed: true }; } });








