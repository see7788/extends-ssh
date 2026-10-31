import Base from "../public/index.ts";
import { hostnameValidator } from "./zod.ts";
import Ssh from "../ssh/index.ts";
import store from "../store.ts";

export default class extends Base {
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute(`set -e
export DEBIAN_FRONTEND=noninteractive
dpkg --configure -a --force-confold
if ! command -v certbot >/dev/null 2>&1 || ! python3 -c 'import certbot_nginx' >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends certbot python3-certbot-nginx -o Dpkg::Options::=--force-confold
fi
certbot --version >/dev/null
python3 -c 'import certbot_nginx'`);
  }

  async makeRemote(hostname: string, nginxBinary: string, nginxConfig: string): Promise<{ readonly certPath: string; readonly keyPath: string; }> {
    const normalizedHostname = hostnameValidator.parse(hostname);
    await this.setupReady();
    const ssh = new Ssh();
    const certificateRoot = store.getState().letsencrypt.root;
    const certificateBase = `${certificateRoot}/${normalizedHostname}`;
    const certPath = `${certificateBase}/fullchain.pem`;
    const keyPath = `${certificateBase}/privkey.pem`;
    const letsEncryptBase = `/etc/letsencrypt/live/${normalizedHostname}`;
    const hookPath = `/etc/letsencrypt/renewal-hooks/deploy/extends-ssh-${normalizedHostname}.sh`;
    await ssh.execute(`set -e
CERTIFICATE_BASE=${ssh.quoteShellArg(certificateBase)}
LETS_ENCRYPT_BASE=${ssh.quoteShellArg(letsEncryptBase)}
if ! test -s "\$CERTIFICATE_BASE/fullchain.pem" \
  || ! test -s "\$CERTIFICATE_BASE/privkey.pem" \
  || ! openssl x509 -checkend 2592000 -noout -in "\$CERTIFICATE_BASE/fullchain.pem" >/dev/null 2>&1; then
  certbot certonly --nginx \
    --nginx-server-root ${ssh.quoteShellArg(nginxConfig.replace(/\/nginx\.conf$/, ""))} \
    --nginx-ctl ${ssh.quoteShellArg(nginxBinary)} \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --keep-until-expiring --preferred-challenges http \
    -d ${ssh.quoteShellArg(normalizedHostname)}
  test -s "\$LETS_ENCRYPT_BASE/fullchain.pem"
  test -s "\$LETS_ENCRYPT_BASE/privkey.pem"
  mkdir -p "\$CERTIFICATE_BASE"
  install -m 0644 "\$LETS_ENCRYPT_BASE/fullchain.pem" "\$CERTIFICATE_BASE/fullchain.pem"
  install -m 0600 "\$LETS_ENCRYPT_BASE/privkey.pem" "\$CERTIFICATE_BASE/privkey.pem"
fi
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > ${ssh.quoteShellArg(hookPath)} <<'HOOK'
#!/bin/sh
set -e
DOMAIN=${normalizedHostname}
CERTIFICATE_BASE=${ssh.quoteShellArg(certificateBase)}
install -m 0644 /etc/letsencrypt/live/$DOMAIN/fullchain.pem "$CERTIFICATE_BASE/fullchain.pem"
install -m 0600 /etc/letsencrypt/live/$DOMAIN/privkey.pem "$CERTIFICATE_BASE/privkey.pem"
${ssh.quoteShellArg(nginxBinary)} -t -c ${ssh.quoteShellArg(nginxConfig)}
${ssh.quoteShellArg(nginxBinary)} -s reload -c ${ssh.quoteShellArg(nginxConfig)}
HOOK
chmod 700 ${ssh.quoteShellArg(hookPath)}
${ssh.quoteShellArg(nginxBinary)} -t -c ${ssh.quoteShellArg(nginxConfig)}
${ssh.quoteShellArg(nginxBinary)} -s reload -c ${ssh.quoteShellArg(nginxConfig)}`);
    return { certPath, keyPath };
  }
}
