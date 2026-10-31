import Base from "../public/index.ts";
import path from "node:path";
import Apt from "../apt/index.ts";
import Ssh from "../ssh/index.ts";
import Sftp from "../sftp/index.ts";
import store from "../store.ts";
import type { Plugin } from "vite";
export default class extends Base {
  constructor(readonly index = 0) {
    super();
  }
  // 官方 kasmweb 前端子模块（Kasm 维护的 noVNC fork）：https://github.com/kasmtech/noVNC
  //针对kasm的ui覆盖
  vitePlugin_kasmUi(): Plugin {
    let outputDirectory!: string;
    return {
      name: "vitePlugin_kasm",
      enforce: "post",
      configResolved: config => {
        outputDirectory = path.resolve(config.root, config.build.outDir);
      },
      closeBundle: async () => {
        try {
          await new Sftp().upload(outputDirectory, store.getState().kasmVnc.server.httpdDirectory);
          console.log("sftp success");
          await this.set(this.index);
          console.log(`set(${this.index}) success`);
        } finally {
          Ssh.disposeAll();
        }
      },
    };
  }
  //针对chromium的拓展
  vitePlugin_chromiumExtension(): Plugin {
    let outputDirectory!: string;
    return {
      name: "vitePlugin_chromium",
      enforce: "post",
      configResolved: config => {
        outputDirectory = path.resolve(config.root, config.build.outDir);
      },
      closeBundle: async () => {
        try {
          const extensionDirectory = store.getState().kasmVnc.chromium.extensionDirectory;
          await new Sftp().upload(outputDirectory, extensionDirectory);
          console.log("sftp success");
          await this.set(this.index);
          console.log(`set(${this.index}) success`);
        } finally {
          Ssh.disposeAll();
        }
      },
    };
  }

  async setup(): Promise<void> {
    const index = this.index;
    const sessionService = this.sessionService(index);
    const install = store.getState().kasmVnc.server;
    const aptPackages = install.aptPackages.join(" ");
    const apt = new Apt();
    const ssh = new Ssh();
    await apt.setupReady();
    await ssh.execute(`
set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v vncserver >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends ${aptPackages} >/dev/null
  . /etc/os-release
  architecture=$(dpkg --print-architecture)
  case "$ID" in
    ubuntu) distribution="ubuntu_$VERSION_CODENAME" ;;
    debian) distribution="debian_$VERSION_CODENAME" ;;
    *) echo "不支持的 KasmVNC 系统: $ID" >&2; exit 1 ;;
  esac
  package=$(mktemp --suffix=.deb)
  release_url=$(curl -fsSLI --retry 3 --connect-timeout 10 --max-time 60 -o /dev/null -w '%{url_effective}' ${ssh.quoteShellArg(install.releaseApi)})
  version=\${release_url##*/v}
  package_url="https://github.com/kasmtech/KasmVNC/releases/download/v\${version}/${install.packagePrefix}_\${distribution}_\${version}_\${architecture}.deb"
  curl -fL --retry 3 --connect-timeout 10 --max-time 180 "$package_url" -o "$package"
  apt-get install -y -qq "$package" >/dev/null
  rm -f "$package"
fi
command -v vncserver >/dev/null 2>&1
`);
    const serviceExists = (await ssh.execute(`
if systemctl cat ${ssh.quoteShellArg(sessionService)} >/dev/null 2>&1; then printf yes; else printf no; fi
`)).stdout.trim() === "yes";
    if (serviceExists) {
      await ssh.execute(`
systemctl enable ${ssh.quoteShellArg(sessionService)} >/dev/null
systemctl start ${ssh.quoteShellArg(sessionService)}
`);
      return;
    }
    await this.apply(index);
  }

  async set(index = this.index): Promise<void> {
    await this.setupReady();
    await this.apply(index);
  }

  private async apply(index: number): Promise<void> {
    const config = this.config(index);
    const httpdDirectory = store.getState().kasmVnc.server.httpdDirectory;
    const type = config.application.type;
    if (type === "chromium") {
      await this.setChromium(index);
    } else if (type === "wechat") {
      await this.setWechat(index);
    } else if (type === "desktop") {
      await this.setDesktop(index);
    }
    const application = config.application;
    const sessionService = this.sessionService(index);
    const user = this.sessionUser(index);
    const home = `/home/${user}`;
    const geometry = `${config.resolution.width}x${config.resolution.height}`;
    const ssh = new Ssh();
    const ports = new Set<number>();
    const displays = new Set<string>();
    for (const item of store.getState().kasmVnc.instances) {
      if (ports.has(item.port)) throw new Error(`KasmVNC port is duplicated: ${item.port}`);
      ports.add(item.port);
      if (!/^:\d+$/.test(item.display)) throw new Error(`KasmVNC display is invalid: ${item.display}`);
      if (displays.has(item.display)) throw new Error(`KasmVNC display is duplicated: ${item.display}`);
      displays.add(item.display);
    }
    const basicAuth = config.basicAuth;
    if (basicAuth.enabled && (!basicAuth.username || basicAuth.password.length < 6)) {
      throw new Error(`KasmVNC ${index} 启用 BasicAuth 后必须配置用户名，密码至少 6 位`);
    }
    const basicAuthCommand = basicAuth.enabled
      ? `export HOME=${ssh.quoteShellArg(home)}; kasmvncpasswd -u ${ssh.quoteShellArg(basicAuth.username)} -wo`
      : "";
    const internalAuthCommand = `export HOME=${ssh.quoteShellArg(home)}; kasmvncpasswd -u ${ssh.quoteShellArg("kasm_internal")} -wo`;
    const basicAuthSetup = basicAuth.enabled
      ? `
rm -f ${ssh.quoteShellArg(home + "/.kasmpasswd")}
printf '%s\n%s\n' ${ssh.quoteShellArg(basicAuth.password)} ${ssh.quoteShellArg(basicAuth.password)} | su -s /bin/bash -c ${ssh.quoteShellArg(basicAuthCommand)} ${ssh.quoteShellArg(user)}
chown ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(home + "/.kasmpasswd")}
chmod 600 ${ssh.quoteShellArg(home + "/.kasmpasswd")}
`
      : `
rm -f ${ssh.quoteShellArg(home + "/.kasmpasswd")}
kasm_password=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
printf '%s\n%s\n' "$kasm_password" "$kasm_password" | su -s /bin/bash -c ${ssh.quoteShellArg(internalAuthCommand)} ${ssh.quoteShellArg(user)}
chown ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(home + "/.kasmpasswd")}
chmod 600 ${ssh.quoteShellArg(home + "/.kasmpasswd")}
`;
    const vncOptions = [
      basicAuth.enabled ? "" : "-disableBasicAuth",
      "-SecurityTypes None", // KasmVNC Web 客户端使用 BasicAuth，不启用未验证的 RFB 认证类型
      `-sslOnly ${config.sslOnly ? 1 : 0}`,
      config.alwaysShared ? "-AlwaysShared" : "",
      `-localhost ${config.localhost ? "yes" : "no"}`,
    ].filter(option => option).join(" ");
    await ssh.execute(`
set -e
mkdir -p ${ssh.quoteShellArg(httpdDirectory)}
if [ ! -f ${ssh.quoteShellArg(httpdDirectory + "/index.html")} ]; then
cp -a /usr/share/kasmvnc/www/. ${ssh.quoteShellArg(httpdDirectory)}/
fi
${basicAuthSetup}
cat > ${ssh.quoteShellArg(home + "/.vnc/kasmvnc.yaml")} <<'YAML'
desktop:
  resolution:
    width: ${config.resolution.width}
    height: ${config.resolution.height}
  pixel_depth: ${config.pixelDepth}
  allow_resize: ${config.allowResize}
network:
  protocol: ${config.networkProtocol}
  interface: ${config.networkInterface}
  websocket_port: ${config.port}
  use_ipv4: ${config.networkUseIpv4}
  use_ipv6: ${config.networkUseIpv6}
  ssl:
    require_ssl: ${config.sslOnly}
user_session:
  concurrent_connections_prompt: ${config.userSessionConcurrentConnectionsPrompt}
  idle_timeout: ${config.userSessionIdleTimeout}
server:
  http:
    httpd_directory: ${httpdDirectory}
  advanced:
    kasm_password_file: ${home}/.kasmpasswd
command_line:
  prompt: ${config.commandLinePrompt}
YAML
chown ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(home + "/.vnc/kasmvnc.yaml")}
cat > ${ssh.quoteShellArg("/etc/systemd/system/" + sessionService)} <<'UNIT'
[Unit]
Description=KasmVNC ${application.type} ${index}
After=network-online.target${type === "chromium" ? " snapd.service" : ""}
Wants=network-online.target

[Service]
Type=forking
User=${user}
Group=${user}
Environment=HOME=${home}
Environment=USER=${user}
RuntimeDirectory=kasm-vnc-${index}
RuntimeDirectoryMode=0700
ExecStart=/usr/bin/vncserver ${config.display} -geometry ${geometry} -depth ${config.pixelDepth} -websocketPort ${config.port} ${vncOptions} -httpd ${httpdDirectory} -xstartup ${home}/.vnc/xstartup
ExecStop=/usr/bin/vncserver -kill ${config.display}
Restart=${config.systemd.restart}
RestartSec=${config.systemd.restartSec}

[Install]
WantedBy=multi-user.target
UNIT
ufw allow ${config.port}/tcp >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable ${ssh.quoteShellArg(sessionService)} >/dev/null
systemctl restart ${ssh.quoteShellArg(sessionService)}
`);
  }

  private async setChromium(index: number): Promise<void> {
    const config = this.config(index);
    const application = config.application;
    if (application.type !== "chromium") throw new Error(`KasmVNC application is not implemented: ${application.type}`);
    const chromium = application;
    const install = store.getState().kasmVnc.chromium;
    const aptPackages = install.aptPackages.join(" ");
    const user = this.sessionUser(index);
    const home = `/home/${user}`;
    const targetFile = `${install.targetRoot}/${index}/target-url`;
    const chromiumDataDir = `${this.directory(install.dataDir, "Chromium dataDir")}${this.instanceSuffix(index)}`;
    const extensionDirectory = this.directory(install.extensionDirectory, "Chromium extensionDirectory");
    const chromiumBinary = install.binary;
    const ssh = new Ssh();
    const apt = new Apt();
    await apt.setupReady();
    await ssh.execute(`
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends ${aptPackages} >/dev/null
systemctl enable --now snapd.socket >/dev/null
for attempt in $(seq 1 30); do
  snap wait system seed.loaded >/dev/null 2>&1 && break
  sleep 1
done
if ! snap list ${ssh.quoteShellArg(install.snapPackage)} >/dev/null 2>&1; then snap install ${ssh.quoteShellArg(install.snapPackage)} >/dev/null; fi
if [ ! -s /etc/ssl/certs/ssl-cert-snakeoil.pem ] || [ ! -s /etc/ssl/private/ssl-cert-snakeoil.key ]; then
  mkdir -p /etc/ssl/private /etc/ssl/certs
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -subj "/CN=$(hostname)" \
    -keyout /etc/ssl/private/ssl-cert-snakeoil.key \
    -out /etc/ssl/certs/ssl-cert-snakeoil.pem >/dev/null 2>&1
  chmod 600 /etc/ssl/private/ssl-cert-snakeoil.key
  chmod 644 /etc/ssl/certs/ssl-cert-snakeoil.pem
fi
command -v vncserver >/dev/null 2>&1
`);

    const encodedTarget = Buffer.from(chromium.url, "utf8").toString("base64");
    const chromiumOptions = [
      chromium.noSandbox ? "--no-sandbox" : "",
      chromium.disableDevShmUsage ? "--disable-dev-shm-usage" : "",
      chromium.disableGpu ? "--disable-gpu" : "",
      chromium.noFirstRun ? "--no-first-run" : "",
      chromium.noDefaultBrowserCheck ? "--no-default-browser-check" : "",
      chromium.kiosk ? "--kiosk" : "",
      `--load-extension=${ssh.quoteShellArg(extensionDirectory)}`,
    ].filter(option => option).join(" ");
    const targetArgument = chromium.appMode ? '--app="$target"' : '"$target"';
    const targetSetup = `
printf %s ${ssh.quoteShellArg(encodedTarget)} | base64 -d > ${ssh.quoteShellArg(targetFile)}
 chmod 644 ${ssh.quoteShellArg(targetFile)}`;
    const applicationLaunch = `target=$(cat ${targetFile})
exec ${chromiumBinary} ${chromiumOptions} --user-data-dir=${chromiumDataDir} ${targetArgument} >${home}/.vnc/chromium.log 2>&1`
    const windowManager = `openbox-session >${home}/.vnc/openbox.log 2>&1 &
 sleep 1`;
    const targetDirectory = targetFile.substring(0, targetFile.lastIndexOf("/"));
    await ssh.execute(`
set -e
if ! id -u ${ssh.quoteShellArg(user)} >/dev/null 2>&1; then useradd --create-home --shell /bin/bash ${ssh.quoteShellArg(user)}; fi
usermod --append --groups ssl-cert ${ssh.quoteShellArg(user)}
mkdir -p ${ssh.quoteShellArg(targetDirectory)} ${ssh.quoteShellArg(home + "/.vnc")} ${ssh.quoteShellArg(chromiumDataDir)}
${targetSetup}
chown -R ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(targetDirectory)} ${ssh.quoteShellArg(home + "/.vnc")} ${ssh.quoteShellArg(chromiumDataDir)}
cat > ${ssh.quoteShellArg(home + "/.vnc/xstartup")} <<'SCRIPT'
#!/usr/bin/env bash
set -e
export XDG_RUNTIME_DIR=/run/kasm-vnc-${index}
${windowManager}
${applicationLaunch}
SCRIPT
chmod 755 ${ssh.quoteShellArg(home + "/.vnc/xstartup")}
chown ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(home + "/.vnc/xstartup")}
`);
  }
  private async setDesktop(index: number): Promise<void> {
    const config = this.config(index);
    const application = config.application;
    if (application.type !== "desktop") throw new Error(`KasmVNC application is not implemented: ${application.type}`);
    const install = store.getState().kasmVnc.desktop;
    const aptPackages = install.aptPackages.join(" ");
    const user = this.sessionUser(index);
    const home = `/home/${user}`;
    const chromiumDataDir = `${this.directory(install.dataDir, "Desktop dataDir")}${this.instanceSuffix(index)}`;
    const ssh = new Ssh();
    const apt = new Apt();
    await apt.setupReady();
    await ssh.execute(`
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends ${aptPackages} >/dev/null
if [ ! -s /etc/ssl/certs/ssl-cert-snakeoil.pem ] || [ ! -s /etc/ssl/private/ssl-cert-snakeoil.key ]; then
  mkdir -p /etc/ssl/private /etc/ssl/certs
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -subj "/CN=$(hostname)" \
    -keyout /etc/ssl/private/ssl-cert-snakeoil.key \
    -out /etc/ssl/certs/ssl-cert-snakeoil.pem >/dev/null 2>&1
  chmod 600 /etc/ssl/private/ssl-cert-snakeoil.key
  chmod 644 /etc/ssl/certs/ssl-cert-snakeoil.pem
fi
command -v vncserver >/dev/null 2>&1
`);

    const applicationLaunch = `exec dbus-launch --exit-with-session startxfce4 >${home}/.vnc/xfce.log 2>&1`;
    const windowManager = "";
    await ssh.execute(`
set -e
if ! id -u ${ssh.quoteShellArg(user)} >/dev/null 2>&1; then useradd --create-home --shell /bin/bash ${ssh.quoteShellArg(user)}; fi
usermod --append --groups ssl-cert ${ssh.quoteShellArg(user)}
mkdir -p ${ssh.quoteShellArg(home + "/.vnc")} ${ssh.quoteShellArg(chromiumDataDir)}
chown -R ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(home + "/.vnc")} ${ssh.quoteShellArg(chromiumDataDir)}
cat > ${ssh.quoteShellArg(home + "/.vnc/xstartup")} <<'SCRIPT'
#!/usr/bin/env bash
set -e
export XDG_RUNTIME_DIR=/run/kasm-vnc-${index}
${windowManager}
${applicationLaunch}
SCRIPT
chmod 755 ${ssh.quoteShellArg(home + "/.vnc/xstartup")}
chown ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(home + "/.vnc/xstartup")}
`);
  }

  private async setWechat(index: number): Promise<void> {
    const config = this.config(index);
    if (config.application.type !== "wechat") throw new Error(`KasmVNC application is not implemented: ${config.application.type}`);
    const application = config.application;
    const install = store.getState().kasmVnc.wechat;
    const aptPackages = install.aptPackages.join(" ");
    const user = this.sessionUser(index);
    const home = `/home/${user}`;
    const dataBaseDir = this.directory(install.dataDir, "WeChat dataDir");
    const filesBaseDir = this.directory(install.filesDir, "WeChat filesDir");
    const dataRoot = path.posix.dirname(dataBaseDir);
    const filesRoot = path.posix.dirname(filesBaseDir);
    if (path.posix.dirname(dataRoot) !== path.posix.dirname(filesRoot) || path.posix.basename(dataRoot) !== path.posix.basename(filesRoot)) {
      throw new Error("WeChat dataDir 和 filesDir 必须位于同一个实例根目录");
    }
    const wechatRoot = path.posix.join(path.posix.dirname(dataRoot), `${path.posix.basename(dataRoot)}${this.instanceSuffix(index)}`);
    const dataDir = path.posix.join(wechatRoot, path.posix.basename(dataBaseDir));
    const filesDir = path.posix.join(wechatRoot, path.posix.basename(filesBaseDir));
    const ssh = new Ssh();
    const apt = new Apt();
    await apt.setupReady();
    await ssh.execute(`
set -e
export DEBIAN_FRONTEND=noninteractive
for source in /etc/apt/sources.list /etc/apt/sources.list.d/*; do
  [ -f "$source" ] || continue
  sed -i 's#mirrors.tencentyun.com#archive.ubuntu.com#g' "$source"
done
apt-get update -qq
apt-get install -y -qq --no-install-recommends ${aptPackages} >/dev/null
if [ ! -s /etc/ssl/certs/ssl-cert-snakeoil.pem ] || [ ! -s /etc/ssl/private/ssl-cert-snakeoil.key ]; then
  mkdir -p /etc/ssl/private /etc/ssl/certs
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -subj "/CN=$(hostname)" \
    -keyout /etc/ssl/private/ssl-cert-snakeoil.key \
    -out /etc/ssl/certs/ssl-cert-snakeoil.pem >/dev/null 2>&1
  chmod 600 /etc/ssl/private/ssl-cert-snakeoil.key
  chmod 644 /etc/ssl/certs/ssl-cert-snakeoil.pem
fi
if ! command -v wechat >/dev/null 2>&1 && [ ! -x ${ssh.quoteShellArg(install.binary)} ]; then
  package=$(mktemp --suffix=.deb)
  curl -fsSL --retry 3 --connect-timeout 10 --max-time 180 ${ssh.quoteShellArg(install.packageUrl)} -o "$package"
  apt-get install -y -qq "$package" >/dev/null
  rm -f "$package"
fi
command -v vncserver >/dev/null 2>&1
`);

    await ssh.execute(`
if ! id -u ${ssh.quoteShellArg(user)} >/dev/null 2>&1; then useradd --create-home --shell /bin/bash ${ssh.quoteShellArg(user)}; fi
usermod --append --groups ssl-cert ${ssh.quoteShellArg(user)}
mkdir -p ${ssh.quoteShellArg(home + "/.vnc")} ${ssh.quoteShellArg(dataDir)} ${ssh.quoteShellArg(filesDir)}
ln -sfn ${ssh.quoteShellArg(dataDir)} ${ssh.quoteShellArg(home + "/.xwechat")}
ln -sfn ${ssh.quoteShellArg(filesDir)} ${ssh.quoteShellArg(home + "/xwechat_files")}
chown -R ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(wechatRoot)} ${ssh.quoteShellArg(home)}
cat > ${ssh.quoteShellArg(home + "/.vnc/xstartup")} <<'SCRIPT'
#!/usr/bin/env bash
set -e
export XDG_RUNTIME_DIR=/run/kasm-vnc-${index}
openbox-session >${home}/.vnc/openbox.log 2>&1 &
sleep 1
wechatExecutable=$(command -v wechat || true)
if [ -z "$wechatExecutable" ] && [ -x ${ssh.quoteShellArg(install.binary)} ]; then wechatExecutable=${ssh.quoteShellArg(install.binary)}; fi
if [ -z "$wechatExecutable" ]; then echo "微信可执行文件不存在" >&2; exit 1; fi
exec "$wechatExecutable" >${home}/.vnc/wechat.log 2>&1
SCRIPT
chmod 755 ${ssh.quoteShellArg(home + "/.vnc/xstartup")}
chown ${ssh.quoteShellArg(user)}:${ssh.quoteShellArg(user)} ${ssh.quoteShellArg(home + "/.vnc/xstartup")}

    `);
  }
  async add(index = this.index): Promise<void> {
    await this.set(index);
  }
  async stop(index: number): Promise<void> {
    const config = this.config(index);
    const sessionService = this.sessionService(index);
    const ssh = new Ssh();
    await ssh.execute(`
systemctl stop ${ssh.quoteShellArg(sessionService)}
`);
  }

  async del(index: number): Promise<void> {
    const config = this.config(index);
    const sessionService = this.sessionService(index);
    const user = this.sessionUser(index);
    const home = `/home/${user}`;
    const targetFile = `${store.getState().kasmVnc.chromium.targetRoot}/${index}/target-url`;
    const ssh = new Ssh();
    await ssh.execute(`
systemctl disable --now ${ssh.quoteShellArg(sessionService)} >/dev/null 2>&1 || true
rm -f ${ssh.quoteShellArg("/etc/systemd/system/" + sessionService)}
systemctl daemon-reload
ufw delete allow ${config.port}/tcp >/dev/null 2>&1 || true
rm -rf ${ssh.quoteShellArg(targetFile.substring(0, targetFile.lastIndexOf("/")))} ${ssh.quoteShellArg(home)}
userdel --remove ${ssh.quoteShellArg(user)} >/dev/null 2>&1 || true
`);
    store.setState(state => {
      state.kasmVnc.instances.splice(index, 1);
    });
  }

  private config(index: number) {
    const config = store.getState().kasmVnc.instances[index];
    if (!config) throw new Error(`KasmVNC instance does not exist: ${index}`);
    return config;
  }

  private directory(value: string, name: string, relative = false): string {
    const valid = value.length > 0
      && !value.includes("..")
      && !value.includes("\\")
      && (relative ? !value.startsWith("/") && !value.includes("/") : value.startsWith("/"));
    if (!valid) throw new Error(`${name} is invalid: ${value}`);
    return value.replace(/\/+$/, "");
  }

  private instanceSuffix(index: number): string {
    const display = this.config(index).display;
    const displayNumber = Number(display.slice(1));
    if (!Number.isInteger(displayNumber) || displayNumber < 1) {
      throw new Error(`KasmVNC display is invalid: ${display}`);
    }
    return displayNumber === 1 ? "" : `-${displayNumber - 1}`;
  }

  private sessionService(index: number): string {
    const application = this.config(index).application.type;
    const suffix = this.instanceSuffix(index);
    if (application === "chromium") return `cloud-kasm-chromium${suffix}.service`;
    if (application === "wechat") return `cloud-kasm-wechat${suffix}.service`;
    return `cloud-kasm-desktop${suffix}.service`;
  }

  private sessionUser(index: number): string {
    const application = this.config(index).application.type;
    const suffix = this.instanceSuffix(index);
    if (application === "chromium") return `chromium-browser${suffix}`;
    if (application === "wechat") return `wechat${suffix}`;
    return `kasm-desktop${suffix}`;
  }
}
