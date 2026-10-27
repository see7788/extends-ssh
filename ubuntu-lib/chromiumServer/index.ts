import Base from "../public/index.ts";
import Apt from "../apt/index.ts";
import Ssh from "../ssh/index.ts";
import store from "../store/index.ts";

export default class extends Base {
  async setup(index = 0): Promise<void> {
    const config = store.getState().chromiumServer[index];
    if (!config) throw new Error(`Chromium instance does not exist: ${index}`);
    const sessionService = `cloud-kasm-chromium-${index}.service`;
    const ssh = new Ssh();
    await ssh.execute(`
set -e
systemctl enable ${ssh.quoteShellArg(sessionService)} >/dev/null
systemctl start ${ssh.quoteShellArg(sessionService)}
`);
  }

  async set(index: number): Promise<void> {
    const state = store.getState();
    const config = state.chromiumServer[index];
    if (!config) throw new Error(`Chromium instance does not exist: ${index}`);
    const sessionService = `cloud-kasm-chromium-${index}.service`;
    const user = `chromium-browser-${index}`;
    const home = `/home/${user}`;
    const targetFile = `/etc/cloud-browser/${index}/target-url`;
    const chromiumDataDir = `${home}/kasm-chromium-data`;
    const chromiumBinary = "/snap/chromium/current/usr/lib/chromium-browser/chrome";
    const ports = new Set<number>();
    for (const config of state.chromiumServer) {
      if (!config) continue;
      if (ports.has(config.kasmVnc.port)) throw new Error(`Chromium port is duplicated: ${config.kasmVnc.port}`);
      ports.add(config.kasmVnc.port);
    }
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
command -v vncserver >/dev/null 2>&1
`);

      const encodedTarget = Buffer.from(config.chromium.url, "utf8").toString("base64");
      const targetDirectory = targetFile.substring(0, targetFile.lastIndexOf("/"));
      const geometry = `${config.kasmVnc.resolution.width}x${config.kasmVnc.resolution.height}`;
      const chromiumOptions = [
        config.chromium.noSandbox ? "--no-sandbox" : "",
        config.chromium.disableDevShmUsage ? "--disable-dev-shm-usage" : "",
        config.chromium.disableGpu ? "--disable-gpu" : "",
        config.chromium.noFirstRun ? "--no-first-run" : "",
        config.chromium.noDefaultBrowserCheck ? "--no-default-browser-check" : "",
        config.chromium.kiosk ? "--kiosk" : "",
      ].filter(option => option).join(" ");
      const vncOptions = [
        config.kasmVnc.disableBasicAuth ? "-disableBasicAuth" : "",
        config.kasmVnc.securityTypes ? `-SecurityTypes ${config.kasmVnc.securityTypes}` : "",
        `-sslOnly ${config.kasmVnc.sslOnly ? 1 : 0}`,
        config.kasmVnc.alwaysShared ? "-AlwaysShared" : "",
        `-localhost ${config.kasmVnc.localhost ? "yes" : "no"}`,
      ].filter(option => option).join(" ");
      await ssh.execute(`
set -e
if ! id -u ${ssh.quoteShellArg(user)} >/dev/null 2>&1; then useradd --create-home --shell /bin/bash ${ssh.quoteShellArg(user)}; fi
mkdir -p ${ssh.quoteShellArg(targetDirectory)} ${ssh.quoteShellArg(home + "/.vnc")} ${ssh.quoteShellArg(chromiumDataDir)}
printf %s ${ssh.quoteShellArg(encodedTarget)} | base64 -d > ${ssh.quoteShellArg(targetFile)}
chown -R ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(targetDirectory)} ${ssh.quoteShellArg(home + "/.vnc")} ${ssh.quoteShellArg(chromiumDataDir)}
chmod 644 ${ssh.quoteShellArg(targetFile)}
cat > ${ssh.quoteShellArg(home + "/.vnc/xstartup")} <<'SCRIPT'
#!/usr/bin/env bash
set -e
export XDG_RUNTIME_DIR=/tmp/${user}-runtime
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
openbox-session >/tmp/${user}-openbox.log 2>&1 &
sleep 1
target=$(cat ${targetFile})
exec ${chromiumBinary} ${chromiumOptions} --user-data-dir=${chromiumDataDir} --app="$target" >/tmp/${user}-chromium.log 2>&1
SCRIPT
chmod 755 ${ssh.quoteShellArg(home + "/.vnc/xstartup")}
chown ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(home + "/.vnc/xstartup")}
if [ ! -s ${ssh.quoteShellArg(home + "/.kasmpasswd")} ]; then
  kasm_password=$(openssl rand -base64 32)
  printf '%s\\n%s\\n' "$kasm_password" "$kasm_password" | su -s /bin/bash -c 'kasmvncpasswd -u ${ssh.quoteShellArg(user)} -wo ${ssh.quoteShellArg(home + "/.kasmpasswd")}' ${ssh.quoteShellArg(user)}
  chown ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(home + "/.kasmpasswd")}
  chmod 600 ${ssh.quoteShellArg(home + "/.kasmpasswd")}
fi
cat > ${ssh.quoteShellArg(home + "/.vnc/kasmvnc.yaml")} <<'YAML'
desktop:
  resolution:
    width: ${config.kasmVnc.resolution.width}
    height: ${config.kasmVnc.resolution.height}
  pixel_depth: ${config.kasmVnc.pixelDepth}
  allow_resize: ${config.kasmVnc.allowResize}
network:
  protocol: ${config.kasmVnc.networkProtocol}
  interface: ${config.kasmVnc.networkInterface}
  websocket_port: ${config.kasmVnc.port}
  use_ipv4: ${config.kasmVnc.networkUseIpv4}
  use_ipv6: ${config.kasmVnc.networkUseIpv6}
  ssl:
    require_ssl: ${config.kasmVnc.networkRequireSsl}
user_session:
  concurrent_connections_prompt: ${config.kasmVnc.userSessionConcurrentConnectionsPrompt}
  idle_timeout: ${config.kasmVnc.userSessionIdleTimeout}
server:
  advanced:
    kasm_password_file: ${home}/.kasmpasswd
command_line:
  prompt: ${config.kasmVnc.commandLinePrompt}
YAML
chown ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(home + "/.vnc/kasmvnc.yaml")}
cat > ${ssh.quoteShellArg("/etc/systemd/system/" + sessionService)} <<'UNIT'
[Unit]
Description=KasmVNC Chromium browser ${index}
After=network-online.target snapd.service
Wants=network-online.target

[Service]
Type=forking
User=${user}
Group=${user}
Environment=HOME=${home}
Environment=USER=${user}
ExecStart=/usr/bin/vncserver ${config.kasmVnc.display} -geometry ${geometry} -depth ${config.kasmVnc.pixelDepth} -websocketPort ${config.kasmVnc.port} ${vncOptions} -xstartup ${home}/.vnc/xstartup
ExecStop=/usr/bin/vncserver -kill ${config.kasmVnc.display}
Restart=${config.systemd.restart}
RestartSec=${config.systemd.restartSec}

[Install]
WantedBy=multi-user.target
UNIT
ufw allow ${config.kasmVnc.port}/tcp >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable ${ssh.quoteShellArg(sessionService)} >/dev/null
systemctl restart ${ssh.quoteShellArg(sessionService)}
`);
  }

  async add(index: number): Promise<void> {
    await this.set(index);
  }

  async stop(index: number): Promise<void> {
    const config = store.getState().chromiumServer[index];
    if (!config) throw new Error(`Chromium instance does not exist: ${index}`);
    const sessionService = `cloud-kasm-chromium-${index}.service`;
    const ssh = new Ssh();
    await ssh.execute(`
systemctl stop ${ssh.quoteShellArg(sessionService)}
`);
  }

  async del(index: number): Promise<void> {
    const state = store.getState();
    const config = state.chromiumServer[index];
    if (!config) throw new Error(`Chromium instance does not exist: ${index}`);
    const sessionService = `cloud-kasm-chromium-${index}.service`;
    const user = `chromium-browser-${index}`;
    const home = `/home/${user}`;
    const targetFile = `/etc/cloud-browser/${index}/target-url`;
    const ssh = new Ssh();
    await ssh.execute(`
systemctl disable --now ${ssh.quoteShellArg(sessionService)} >/dev/null 2>&1 || true
rm -f ${ssh.quoteShellArg("/etc/systemd/system/" + sessionService)}
systemctl daemon-reload
ufw delete allow ${config.kasmVnc.port}/tcp >/dev/null 2>&1 || true
rm -rf ${ssh.quoteShellArg(targetFile.substring(0, targetFile.lastIndexOf("/")))} ${ssh.quoteShellArg(home)}
userdel --remove ${ssh.quoteShellArg(user)} >/dev/null 2>&1 || true
`);
    store.setState(state => {
      state.chromiumServer.splice(index, 1);
    });
  }
}
