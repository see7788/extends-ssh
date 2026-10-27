import Base from "../public/index.ts";
import Apt from "../apt/index.ts";
import { targetUrlValidator } from "./zod.ts";
import Ssh from "../ssh/index.ts";

export const browserConfig = {
  publicPort: 10_003,
  display: ":1",
  sessionService: "cloud-kasm-chromium.service",
  targetFile: "/etc/cloud-browser/target-url",
  targetDefault: "https://github.com/",
  user: "chromium-browser",
  home: "/home/chromium-browser",
  chromiumDataDir: "/home/chromium-browser/kasm-chromium-data",
  chromiumBinary: "/snap/chromium/current/usr/lib/chromium-browser/chrome",
  resolution: { width: 1_440, height: 900 },
  allowResize: true,
} as const;

type ChromiumEndpoint = {
  readonly host: string;
  readonly port: typeof browserConfig.publicPort;
  readonly secure: false;
  readonly url: string;
  readonly accessUrl: string;
};

export default class extends Base {
  protected async setup(): Promise<void> {
    const apt = new Apt();
    const ssh = new Ssh();
    await apt.setupReady();
      await ssh.execute(`
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends openssl python3 openbox snapd libasound2t64 libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libxss1 libu2f-udev libvulkan1 >/dev/null
systemctl enable --now snapd.socket >/dev/null
for attempt in $(seq 1 30); do
  snap wait system seed.loaded >/dev/null 2>&1 && break
  sleep 1
done
if ! snap list chromium >/dev/null 2>&1; then snap install chromium >/dev/null; fi
if ! id -u ${browserConfig.user} >/dev/null 2>&1; then useradd --create-home --shell /bin/bash ${browserConfig.user}; fi
mkdir -p /etc/cloud-browser ${browserConfig.home}/.vnc
chown -R ${browserConfig.user}:${browserConfig.user} /etc/cloud-browser ${browserConfig.home}/.vnc
if [ ! -s ${browserConfig.targetFile} ]; then
  printf %s ${ssh.quoteShellArg(Buffer.from(browserConfig.targetDefault, "utf8").toString("base64"))} | base64 -d > ${browserConfig.targetFile}
fi
chown ${browserConfig.user}:${browserConfig.user} ${browserConfig.targetFile}
chmod 644 ${browserConfig.targetFile}
if ! command -v vncserver >/dev/null 2>&1; then
  codename=$( . /etc/os-release; printf %s "$VERSION_CODENAME" )
  arch=$(dpkg --print-architecture)
  asset=$(python3 - "$codename" "$arch" <<'PY'
import json
import sys
import urllib.request

codename, arch = sys.argv[1:]
release = json.load(urllib.request.urlopen("https://api.github.com/repos/kasmtech/KasmVNC/releases/latest"))
assets = [item["browser_download_url"] for item in release["assets"]]
need = [f"_{codename}_", f"_{arch}.deb"]
for asset in assets:
    name = asset.rsplit("/", 1)[-1].lower()
    if name.endswith(".deb") and all(part in name for part in need):
        print(asset)
        break
else:
    raise SystemExit(f"没有找到 Ubuntu {codename}/{arch} 的 KasmVNC deb 包")
PY
)
  test -n "$asset"
  curl -fsSL "$asset" -o /tmp/kasmvncserver.deb
  apt-get install -y -qq /tmp/kasmvncserver.deb >/dev/null
  rm -f /tmp/kasmvncserver.deb
fi
cat > ${browserConfig.home}/.vnc/xstartup <<'SCRIPT'
#!/usr/bin/env bash
set -e
export XDG_RUNTIME_DIR=/tmp/${browserConfig.user}-runtime
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
openbox-session >/tmp/cloud-kasm-openbox.log 2>&1 &
sleep 1
target=$(cat ${browserConfig.targetFile})
exec ${browserConfig.chromiumBinary} --no-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --no-default-browser-check --kiosk --user-data-dir=${browserConfig.chromiumDataDir} --app="$target" >/tmp/cloud-kasm-chromium.log 2>&1
SCRIPT
chmod 755 ${browserConfig.home}/.vnc/xstartup
chown ${browserConfig.user}:${browserConfig.user} ${browserConfig.home}/.vnc/xstartup
if [ ! -s ${browserConfig.home}/.kasmpasswd ]; then
  kasm_password=$(openssl rand -base64 32)
  printf '%s\n%s\n' "$kasm_password" "$kasm_password" | su -s /bin/bash -c 'kasmvncpasswd -u ${browserConfig.user} -wo ${browserConfig.home}/.kasmpasswd' ${browserConfig.user}
  chown ${browserConfig.user}:${browserConfig.user} ${browserConfig.home}/.kasmpasswd
  chmod 600 ${browserConfig.home}/.kasmpasswd
fi
cat > /etc/kasmvnc/kasmvnc.yaml <<'YAML'
desktop:
  resolution:
    width: ${browserConfig.resolution.width}
    height: ${browserConfig.resolution.height}
  allow_resize: ${browserConfig.allowResize}
network:
  protocol: http
  interface: 0.0.0.0
  websocket_port: ${browserConfig.publicPort}
  use_ipv4: true
  use_ipv6: false
  ssl:
    require_ssl: false
user_session:
  concurrent_connections_prompt: false
  idle_timeout: never
server:
  advanced:
    kasm_password_file: ${browserConfig.home}/.kasmpasswd
command_line:
  prompt: false
YAML
cat > /etc/systemd/system/${browserConfig.sessionService} <<'UNIT'
[Unit]
Description=KasmVNC Chromium browser
After=network-online.target snapd.service
Wants=network-online.target

[Service]
Type=forking
User=${browserConfig.user}
Group=${browserConfig.user}
Environment=HOME=${browserConfig.home}
Environment=USER=${browserConfig.user}
ExecStart=/usr/bin/vncserver ${browserConfig.display} -geometry ${browserConfig.resolution.width}x${browserConfig.resolution.height} -depth 24 -websocketPort ${browserConfig.publicPort} -disableBasicAuth -SecurityTypes None -sslOnly 0 -AlwaysShared -localhost no -xstartup ${browserConfig.home}/.vnc/xstartup
ExecStop=/usr/bin/vncserver -kill ${browserConfig.display}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
ufw allow ${browserConfig.publicPort}/tcp >/dev/null
systemctl daemon-reload
systemctl enable ${browserConfig.sessionService} >/dev/null
systemctl restart ${browserConfig.sessionService}
`);
  }

  async ensure(url?: string): Promise<ChromiumEndpoint> {
    await this.setupReady();
    if (url !== undefined) await this.setTarget(url);
    const ssh = new Ssh();
    const { host } = await ssh.config();
    const target = await this.getTarget();
    return {
      host,
      port: browserConfig.publicPort,
      secure: false,
      url: target,
      accessUrl: `http://${host}:${browserConfig.publicPort}/`,
    };
  }

  async hasRemote(): Promise<boolean> {
    const ssh = new Ssh();
    const result = await ssh.execute(`if systemctl is-active --quiet ${browserConfig.sessionService} && ss -ltnH | awk '$4 ~ /(^|:)${browserConfig.publicPort}$/ { found=1 } END { exit !found }'; then printf true; else printf false; fi`);
    return result.stdout.trim() === "true";
  }

  async setTarget(url: string): Promise<ChromiumEndpoint> {
    const target = targetUrlValidator.parse(url);
    await this.setupReady();
    const ssh = new Ssh();
    const encoded = Buffer.from(target, "utf8").toString("base64");
    await ssh.execute(`
set -e
printf %s ${ssh.quoteShellArg(encoded)} | base64 -d > ${browserConfig.targetFile}
chown ${browserConfig.user}:${browserConfig.user} ${browserConfig.targetFile}
chmod 644 ${browserConfig.targetFile}
systemctl restart ${browserConfig.sessionService}
`);
    const { host } = await ssh.config();
    return {
      host,
      port: browserConfig.publicPort,
      secure: false,
      url: target,
      accessUrl: `http://${host}:${browserConfig.publicPort}/`,
    };
  }

  private async getTarget(): Promise<string> {
    const ssh = new Ssh();
    const result = await ssh.execute(`cat ${browserConfig.targetFile} 2>/dev/null || printf ''`);
    return result.stdout.trim();
  }

}
