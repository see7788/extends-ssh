import Base from "../public/index.ts";
import { hostnameValidator } from "./zod.ts";
import Ssh from "../ssh/index.ts";
import store from "../store/index.ts";

type CertificateFiles = {
  readonly certPath: string;
  readonly keyPath: string;
};

export default class extends Base {
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute(`set -e
if ! command -v openssl >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends openssl >/dev/null
fi
openssl version >/dev/null`);
  }
  async makeRemote(hostname: string): Promise<CertificateFiles> {
    await this.setupReady();
    const ssh = new Ssh();
    const base = `${store.getState().certificate.root}/${hostname}`;
    const certPath = `${base}/fullchain.pem`;
    const keyPath = `${base}/privkey.pem`;
    const shell = (item: string) => `'${item.replace(/'/g, `\'"'"'`)}'`;
    await ssh.execute(`set -e
mkdir -p ${shell(base)}
if [ ! -s ${shell(certPath)} ] || [ ! -s ${shell(keyPath)} ] || ! openssl x509 -checkend 2592000 -noout -in ${shell(certPath)} >/dev/null 2>&1; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout ${shell(keyPath)} -out ${shell(certPath)} \
    -subj ${shell(`/CN=${hostname}`)} -addext ${shell(`subjectAltName=DNS:${hostname}`)} >/dev/null 2>&1
  chmod 600 ${shell(keyPath)}
  chmod 644 ${shell(certPath)}
fi`);
    return { certPath, keyPath };
  }

  async hasRemote(hostname: string): Promise<boolean> {
    const ssh = new Ssh();
    const value = hostnameValidator.parse(hostname);
    const base = `${store.getState().certificate.root}/${value}`;
    const certPath = `${base}/fullchain.pem`;
    const keyPath = `${base}/privkey.pem`;
    const shell = (item: string) => `'${item.replace(/'/g, `\'"'"'`)}'`;
    const result = await ssh.execute(`if [ -s ${shell(certPath)} ] \
  && [ -s ${shell(keyPath)} ] \
  && openssl x509 -checkend 2592000 -noout -in ${shell(certPath)} >/dev/null 2>&1; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }
}
