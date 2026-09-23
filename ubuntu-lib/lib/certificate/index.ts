import Base from "../public/Base.ts";
import { posix } from "node:path";
import mcpserver from "mcpserver";
import { z } from "zod";
import { ssh } from "../ssh/index.ts";
import store from "../store/index.ts";
import { certificateRootValidator } from "./store.ts";

const hostnameValidator = z.string().trim().toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i);
const inputValidator = z.object({ hostname: hostnameValidator }).strict();

type Current = {
  readonly certPath: string;
  readonly keyPath: string;
};

class Certificate extends Base<(hostname: string) => Promise<Current>> {
  readonly current = this.ensure.bind(this);

  protected async remoteIsRunning(): Promise<void> {
    await ssh.execute("true");
  }
  async ensure(hostname: string): Promise<Current> {
    await this.remoteIsRunning();
    const value = hostnameValidator.parse(hostname);
    const root = certificateRootValidator.parse(store.getState().certificate.root);
    const base = posix.join(root, value);
    const certPath = `${base}/fullchain.pem`;
    const keyPath = `${base}/privkey.pem`;
    const shell = (item: string) => `'${item.replace(/'/g, `\'"'"'`)}'`;
    await ssh.execute(`set -e
if ! command -v openssl >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends openssl >/dev/null
fi
mkdir -p ${shell(base)}
if [ ! -s ${shell(certPath)} ] || [ ! -s ${shell(keyPath)} ] || ! openssl x509 -checkend 2592000 -noout -in ${shell(certPath)} >/dev/null 2>&1; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout ${shell(keyPath)} -out ${shell(certPath)} \
    -subj ${shell(`/CN=${value}`)} -addext ${shell(`subjectAltName=DNS:${value}`)} >/dev/null 2>&1
  chmod 600 ${shell(keyPath)}
  chmod 644 ${shell(certPath)}
fi`);
    return { certPath, keyPath };
  }
}

export const certificate = new Certificate();

export default mcpserver.metas("/certificate").add({
  protocol: "tool",
  path: "/ensure",
  description: "为指定域名生成并确保可用的自签名 TLS 证书。",
  schema: inputValidator.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async input => await certificate.current(input.hostname),
});
