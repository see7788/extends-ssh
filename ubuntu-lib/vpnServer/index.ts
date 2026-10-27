import Base from "../public/index.ts";
import { subscriptionUrlValidator } from "./zod.ts";
import Ssh from "../ssh/index.ts";

const vpnConfig = {
  service: "cloud-mihomo.service",
  binary: "/usr/local/bin/mihomo",
  configDir: "/etc/mihomo",
  configFile: "/etc/mihomo/config.yaml",
  subscription: {
    url: "http://43.135.28.238/link/cKugdo3G28Iep4tV?clash=2",
    retry: 3,
    connectTimeoutSeconds: 10,
    maxTimeSeconds: 120,
  },
  releaseApi: "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest",
  binaryAssetPrefix: "mihomo-linux-amd64",
  proxySelection: {
    groupName: "",
    proxyName: "",
  },
  mixedPort: 7_890,
  socksPort: 7_891,
  redirPort: 7_892,
  externalController: "127.0.0.1:9_090",
  tunName: "mihomo",
  tunStack: "system",
  tunAutoRoute: true,
  tunAutoRedirect: true,
  tunAutoDetectInterface: true,
  mode: "rule",
  allowLan: false,
  dns: {
    enable: true,
    listen: "127.0.0.1:7_895",
    enhancedMode: "fake-ip",
    nameserver: ["223.5.5.5", "1.1.1.1"],
  },
} as const;

type VpnStatus = {
  readonly host: string;
  readonly service: string;
  readonly configured: boolean;
  readonly running: boolean;
  readonly mixedPort: typeof vpnConfig.mixedPort;
  readonly socksPort: typeof vpnConfig.socksPort;
  readonly tun: boolean;
};

export default class extends Base {
  protected async setup(): Promise<void> {
    const ssh = new Ssh();
    await ssh.execute(`
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl gzip iproute2 iptables python3 python3-yaml >/dev/null
mkdir -p ${vpnConfig.configDir}
chmod 700 ${vpnConfig.configDir}
if [ ! -x ${vpnConfig.binary} ]; then
  release_json=$(mktemp)
  asset_url=$(mktemp)
  curl -fsSL --retry 3 --connect-timeout 10 --max-time 60 ${ssh.quoteShellArg(vpnConfig.releaseApi)} -o "$release_json"
  python3 - "$release_json" ${ssh.quoteShellArg(vpnConfig.binaryAssetPrefix)} > "$asset_url" <<'PY'
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
  curl -fsSL --retry 3 --connect-timeout 10 --max-time 120 "$(cat "$asset_url")" | gzip -d > ${vpnConfig.binary}
  chmod 755 ${vpnConfig.binary}
  rm -f "$release_json" "$asset_url"
fi
${vpnConfig.binary} -v >/dev/null
cat > /etc/systemd/system/${vpnConfig.service} <<'UNIT'
[Unit]
Description=Mihomo cloud-wide proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${vpnConfig.binary} -d ${vpnConfig.configDir}
Restart=always
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable ${vpnConfig.service} >/dev/null
if [ -s ${vpnConfig.configFile} ]; then
  systemctl restart ${vpnConfig.service}
fi
`);
  }

  async ensure(url?: string): Promise<VpnStatus> {
    await this.setupReady();
    const subscriptionUrl = url ?? vpnConfig.subscription.url;
    if (subscriptionUrl) await this.configure(subscriptionUrl);
    return this.status();
  };

  async hasRemote(): Promise<boolean> {
    const ssh = new Ssh();
    const result = await ssh.execute(`
if [ -x ${vpnConfig.binary} ] && [ -s ${vpnConfig.configFile} ] && systemctl is-active --quiet ${vpnConfig.service} && ip link show ${vpnConfig.tunName} >/dev/null 2>&1; then
  printf true
else
  printf false
fi
`);
    return result.stdout.trim() === "true";
  }

  async configure(url: string): Promise<void> {
    const subscriptionUrl = subscriptionUrlValidator.parse(url);
    await this.setupReady();
    const ssh = new Ssh();
    await ssh.execute(`
set -e
subscription_response=$(mktemp)
trap 'rm -f "$subscription_response"' EXIT
curl -fsSL --compressed --retry ${vpnConfig.subscription.retry} --connect-timeout ${vpnConfig.subscription.connectTimeoutSeconds} --max-time ${vpnConfig.subscription.maxTimeSeconds} --url ${ssh.quoteShellArg(subscriptionUrl)} -o "$subscription_response"
python3 - "$subscription_response" ${vpnConfig.configFile} <<'PY'
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

selection_group_name = ${ssh.quoteShellArg(vpnConfig.proxySelection.groupName)}
selection_proxy_name = ${ssh.quoteShellArg(vpnConfig.proxySelection.proxyName)}
if bool(selection_group_name) != bool(selection_proxy_name):
    raise SystemExit("proxySelection.groupName 和 proxySelection.proxyName 必须同时配置")
if selection_group_name:
    groups = config.get("proxy-groups")
    if not isinstance(groups, list):
        raise SystemExit("订阅配置没有 proxy-groups，无法设置指定节点")
    group = next((item for item in groups if isinstance(item, dict) and item.get("name") == selection_group_name), None)
    if not isinstance(group, dict):
        raise SystemExit(f"没有找到代理组：{selection_group_name}")
    proxies = group.get("proxies")
    if not isinstance(proxies, list) or selection_proxy_name not in proxies:
        raise SystemExit(f"代理组 {selection_group_name} 中没有节点：{selection_proxy_name}")
    group["proxies"] = [selection_proxy_name] + [item for item in proxies if item != selection_proxy_name]

config["mixed-port"] = ${vpnConfig.mixedPort}
config["socks-port"] = ${vpnConfig.socksPort}
config["redir-port"] = ${vpnConfig.redirPort}
config["allow-lan"] = ${vpnConfig.allowLan ? "True" : "False"}
config["mode"] = ${ssh.quoteShellArg(vpnConfig.mode)}
config["external-controller"] = ${ssh.quoteShellArg(vpnConfig.externalController)}
tun = config.get("tun") if isinstance(config.get("tun"), dict) else {}
tun.update({
    "enable": True,
    "stack": ${ssh.quoteShellArg(vpnConfig.tunStack)},
    "auto-route": ${vpnConfig.tunAutoRoute ? "True" : "False"},
    "auto-redirect": ${vpnConfig.tunAutoRedirect ? "True" : "False"},
    "auto-detect-interface": ${vpnConfig.tunAutoDetectInterface ? "True" : "False"},
    "device": ${ssh.quoteShellArg(vpnConfig.tunName)},
})
config["tun"] = tun
dns = config.get("dns") if isinstance(config.get("dns"), dict) else {}
dns.setdefault("enable", ${vpnConfig.dns.enable ? "True" : "False"})
dns.setdefault("listen", ${ssh.quoteShellArg(vpnConfig.dns.listen)})
dns.setdefault("enhanced-mode", ${ssh.quoteShellArg(vpnConfig.dns.enhancedMode)})
dns.setdefault("nameserver", ${JSON.stringify(vpnConfig.dns.nameserver)})
config["dns"] = dns
target_path.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding="utf-8")
PY
chmod 600 ${vpnConfig.configFile}
${vpnConfig.binary} -t -d ${vpnConfig.configDir}
systemctl restart ${vpnConfig.service}
systemctl is-active --quiet ${vpnConfig.service}
`);
  }

  async status(): Promise<VpnStatus> {
    const ssh = new Ssh();
    const result = await ssh.execute(`
configured=false
running=false
tun=false
if [ -s ${vpnConfig.configFile} ]; then configured=true; fi
if systemctl is-active --quiet ${vpnConfig.service}; then running=true; fi
if ip link show ${vpnConfig.tunName} >/dev/null 2>&1; then tun=true; fi
printf '%s %s %s' "$configured" "$running" "$tun"
`);
    const [configured, running, tun] = result.stdout.trim().split(/\s+/);
    const { host } = await ssh.config();
    return {
      host,
      service: vpnConfig.service,
      configured: configured === "true",
      running: running === "true",
      mixedPort: vpnConfig.mixedPort,
      socksPort: vpnConfig.socksPort,
      tun: tun === "true",
    };
  }

}
