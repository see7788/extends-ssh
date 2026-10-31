import Base from "../public/index.ts";
import { subscriptionUrlValidator } from "./zod.ts";
import Ssh from "../ssh/index.ts";
import store from "../store.ts";

export default class extends Base {
  async setup(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute(`
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl gzip iproute2 iptables python3 python3-yaml >/dev/null
mkdir -p /etc/mihomo
chmod 700 /etc/mihomo
if [ ! -x /usr/local/bin/mihomo ]; then
  release_json=$(mktemp)
  asset_url=$(mktemp)
  curl -fsSL --retry 3 --connect-timeout 10 --max-time 60 ${ssh.quoteShellArg("https://api.github.com/repos/MetaCubeX/mihomo/releases/latest")} -o "$release_json"
  python3 - "$release_json" ${ssh.quoteShellArg("mihomo-linux-amd64")} > "$asset_url" <<'PY'
import json
import pathlib
import sys

release = json.loads(pathlib.Path(sys.argv[1]).read_text())
prefix = sys.argv[2]
assets = [asset["browser_download_url"] for asset in release.get("assets", [])]
candidates = [
    url for url in assets
    if pathlib.PurePosixPath(url).name.startswith(prefix)
    and pathlib.PurePosixPath(url).name.endswith(".gz")
    and "compatible" not in pathlib.PurePosixPath(url).name
]
if not candidates:
    raise SystemExit(f"没有找到 Mihomo Linux amd64 发布包：{prefix}")
print(candidates[0])
PY
  curl -fsSL --retry 3 --connect-timeout 10 --max-time 120 "$(cat "$asset_url")" | gzip -d > /usr/local/bin/mihomo
  chmod 755 /usr/local/bin/mihomo
  rm -f "$release_json" "$asset_url"
fi
/usr/local/bin/mihomo -v >/dev/null
cat > /etc/systemd/system/cloud-mihomo.service <<'UNIT'
[Unit]
Description=Mihomo cloud-wide proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/mihomo -d /etc/mihomo
Restart=always
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable cloud-mihomo.service >/dev/null
`);
    const healthy = (await ssh.execute(`
if systemctl is-active --quiet cloud-mihomo.service \
  && test -s /etc/mihomo/config.yaml \
  && /usr/local/bin/mihomo -t -d /etc/mihomo >/dev/null 2>&1; then
  printf yes
else
  printf no
fi
`)).stdout.trim() === "yes";
    if (!healthy) await this.apply();
  }

  async stop(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute(`
set -e
systemctl stop cloud-mihomo.service
if systemctl is-active --quiet cloud-mihomo.service; then
  echo "cloud-mihomo.service 停止失败" >&2
  exit 1
fi
`);
  }

  /** 将 store 中的完整配置应用到现有 Mihomo 配置并重启服务。 */
  async set(): Promise<void> {
    await this.setupReady();
    await this.apply();
  }

  private async apply(): Promise<void> {
    const vpnState = store.getState().vpnMihomo;
    const subscriptionUrl = subscriptionUrlValidator.parse(vpnState.subscriptionUrl);
    const ssh = new Ssh();
    await ssh.execute(`
set -e
subscription_response=$(mktemp)
trap 'rm -f "$subscription_response"' EXIT
curl -fsSL --compressed --retry 3 --connect-timeout 10 --max-time 120 --url ${ssh.quoteShellArg(subscriptionUrl)} -o "$subscription_response"
python3 - "$subscription_response" /etc/mihomo/config.yaml <<'PY'
import base64
import pathlib
import sys
import yaml

source_path = pathlib.Path(sys.argv[1])
target_path = pathlib.Path(sys.argv[2])
raw = source_path.read_bytes()
text = raw.decode("utf-8-sig")
try:
    config = yaml.safe_load(text)
except yaml.YAMLError:
    config = None
if not isinstance(config, dict):
    decoded = base64.b64decode(b"".join(raw.split()), validate=True)
    config = yaml.safe_load(decoded.decode("utf-8-sig"))
if not isinstance(config, dict):
    raise SystemExit("订阅内容不是 Clash/Mihomo YAML 配置")
target_path.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding="utf-8")
PY
`);
    await ssh.execute(`
set -e
test -s /etc/mihomo/config.yaml
test -x /usr/local/bin/mihomo
python3 - /etc/mihomo/config.yaml <<'PY'
import pathlib
import sys
import yaml

target_path = pathlib.Path(sys.argv[1])
config = yaml.safe_load(target_path.read_text(encoding="utf-8-sig"))
if not isinstance(config, dict):
    raise SystemExit("现有 Mihomo 配置不是有效对象")

selection_group_name = ${ssh.quoteShellArg(vpnState.proxySelection.groupName)}
selection_proxy_name = ${ssh.quoteShellArg(vpnState.proxySelection.proxyName)}
if bool(selection_group_name) != bool(selection_proxy_name):
    raise SystemExit("proxySelection.groupName 和 proxySelection.proxyName 必须同时配置")
if selection_group_name:
    groups = config.get("proxy-groups")
    if not isinstance(groups, list):
        raise SystemExit("配置没有 proxy-groups，无法设置指定节点")
    group = next((item for item in groups if isinstance(item, dict) and item.get("name") == selection_group_name), None)
    if not isinstance(group, dict):
        raise SystemExit(f"没有找到代理组：{selection_group_name}")
    proxies = group.get("proxies")
    if not isinstance(proxies, list) or selection_proxy_name not in proxies:
        raise SystemExit(f"代理组 {selection_group_name} 中没有节点：{selection_proxy_name}")
    group["proxies"] = [selection_proxy_name] + [item for item in proxies if item != selection_proxy_name]

config["mixed-port"] = ${vpnState.mixedPort}
config["socks-port"] = ${vpnState.socksPort}
config["redir-port"] = ${vpnState.redirPort}
config["allow-lan"] = ${vpnState.allowLan ? "True" : "False"}
config["mode"] = ${ssh.quoteShellArg(vpnState.mode)}
config["external-controller"] = ${ssh.quoteShellArg(vpnState.externalController)}
tun = config.get("tun") if isinstance(config.get("tun"), dict) else {}
tun.update({
    "enable": True,
    "stack": ${ssh.quoteShellArg(vpnState.tunStack)},
    "auto-route": ${vpnState.tunAutoRoute ? "True" : "False"},
    "auto-redirect": ${vpnState.tunAutoRedirect ? "True" : "False"},
    "auto-detect-interface": ${vpnState.tunAutoDetectInterface ? "True" : "False"},
    "device": ${ssh.quoteShellArg(vpnState.tunName)},
})
config["tun"] = tun
dns = config.get("dns") if isinstance(config.get("dns"), dict) else {}
dns["enable"] = ${vpnState.dns.enable ? "True" : "False"}
dns["listen"] = ${ssh.quoteShellArg(vpnState.dns.listen)}
dns["enhanced-mode"] = ${ssh.quoteShellArg(vpnState.dns.enhancedMode)}
dns["nameserver"] = ${JSON.stringify(vpnState.dns.nameservers)}
dns["fake-ip-filter-mode"] = "blacklist"
dns["fake-ip-filter"] = ${JSON.stringify(vpnState.dns.fakeIpFilter)}
config["dns"] = dns
target_path.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding="utf-8")
PY
chmod 600 /etc/mihomo/config.yaml
/usr/local/bin/mihomo -t -d /etc/mihomo
systemctl restart cloud-mihomo.service
systemctl is-active --quiet cloud-mihomo.service
`);
    store.setState(state => {
      state.vpnMihomo.subscriptionUrl = subscriptionUrl;
    });
  }


}
