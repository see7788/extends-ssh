import mcpserver from "mcpserver";
import { z } from "zod";

import { apt } from "../Apt/index.ts";
import { pm2 } from "../Pm2/index.ts";
import { sshForward } from "../SshForward/index.ts";
import store from "../store/index.ts";
import { ssh } from "../Ssh/index.ts";

const devPortValidator = z.number().int().min(1).max(9_999);



const inputValidator = z.object({ port: devPortValidator }).strict();
type Remote = {
  readonly subdomain: string;
  hasRemote(): Promise<boolean>;
  close(): Promise<void>;
};

class Nginx {
  private runningPromise?: Promise<void>;
  private readonly operations = new Map<number, Promise<void>>();
  private remoteIsRunning(): Promise<void> {
    if (this.runningPromise) return this.runningPromise;
    const promise = this.ensure().finally(() => { if (this.runningPromise === promise) this.runningPromise = undefined; });
    this.runningPromise = promise;
    return promise;
  }
  public async getRemote(port: number): Promise<Remote> {
    const value = inputValidator.parse({ port }).port;
    if (!await this.hasRemote(value)) {
      throw new Error(`开发端口尚未分配 Nginx 远程路由: ${value}`);
    }
    return this.remote(value);
  }
  public async hasRemote(port: number): Promise<boolean> {
    const value = inputValidator.parse({ port }).port;
    const description = this.remoteDescription(value);
    const configPath = `/etc/nginx/sites-enabled/extends-ssh-${value}`;
    await ssh.remoteIsRunning();
    const result = await ssh.execute(`if [ -f ${this.shell(configPath)} ] \
  && grep -Fq -- ${this.shell(`server_name ${description.subdomain};`)} ${this.shell(configPath)} \
  && grep -Fq -- ${this.shell(`proxy_pass http://127.0.0.1:${value};`)} ${this.shell(configPath)}; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }
  public async makeRemote(port: number): Promise<Remote> {
    const value = inputValidator.parse({ port }).port;
    const current = this.operations.get(value);
    if (current) {
      await current;
      return this.remote(value);
    }
    const operation = this.makeRemoteEnsure(value).finally(() => {
      if (this.operations.get(value) === operation) this.operations.delete(value);
    });
    this.operations.set(value, operation);
    await operation;
    return this.remote(value);
  }
  private async makeRemoteEnsure(value: number): Promise<void> {
    await this.remoteIsRunning();
    const hasForward = await sshForward.hasRemote(value);
    const hasProcess = !hasForward && await pm2.refresh(value) === "running";
    if (!hasForward && !hasProcess) {
      throw new Error(`开发端口尚未分配 SSH 内网穿透或 PM2 服务: ${value}`);
    }
    const upstreamPort = value;
    const subdomain = this.remoteDescription(value).subdomain;
    const shell = (v: string) => `'${v.replace(/'/g, `\'"'"'`)}'`;
    await ssh.execute(`set -e
cat > /etc/nginx/sites-available/extends-ssh-${value} <<'NGINX'
server {
  listen 80;
  server_name ${subdomain};
  location / { proxy_pass http://127.0.0.1:${upstreamPort}; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
}
NGINX
ln -sfn /etc/nginx/sites-available/extends-ssh-${value} /etc/nginx/sites-enabled/extends-ssh-${value}
nginx -t
systemctl reload nginx`);
  }
  public async closeRemote(port: number): Promise<void> {
    const value = inputValidator.parse({ port }).port;
    await this.operations.get(value)?.catch(() => undefined);
    await this.remoteIsRunning();
    await ssh.execute(`rm -f /etc/nginx/sites-enabled/extends-ssh-${value} /etc/nginx/sites-available/extends-ssh-${value}; nginx -t && systemctl reload nginx`);
  }
  private remote(port: number): Remote {
    const value = inputValidator.parse({ port }).port;
    const description = this.remoteDescription(value);
    return {
      subdomain: description.subdomain,
      hasRemote: () => this.hasRemote(value),
      close: () => this.closeRemote(value),
    };
  }

  private shell(value: string): string { return `'${value.replace(/'/g, `\'"'"'`)}'`; }
  private remoteDescription(port: number): { subdomain: string } {
    return { subdomain: `${port}.${store.getState().domain}` };
  }
  private async ensure(): Promise<void> {
    await apt.remoteIsRunning();
    await ssh.execute("set -e; command -v nginx >/dev/null 2>&1 || apt-get install -y -qq --no-install-recommends nginx >/dev/null; systemctl enable nginx --now >/dev/null; nginx -t");
  }
}

export const nginx = new Nginx();
export default mcpserver.metas("/nginx")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口建立公网 Nginx 路由。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await nginx.makeRemote(input.port); return { subdomain: remote.subdomain }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口对应的公网 Nginx 路由是否已分配。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await nginx.hasRemote(input.port) }) })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的公网 Nginx 路由。", schema: inputValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await nginx.getRemote(input.port); return { subdomain: remote.subdomain }; } })
  .add({ protocol: "tool", path: "/closeRemote", description: "关闭开发端口对应的公网 Nginx 路由。", schema: inputValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { await nginx.closeRemote(input.port); return { closed: true }; } });








