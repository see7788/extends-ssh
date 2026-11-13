import store from "../store.ts";

const setupTasks = new WeakMap<object, Promise<void>>();

export default abstract class {
  // 各切片共用的基础环境定义：固定路径与软件版本集中维护。
  // 未配置固定版本的软件由对应切片按官方渠道动态获取最新稳定版。
  // 实例参数派生的目录（如 /home/<user>、/run/kasm-vnc-<index>）由切片自行生成。
  protected readonly envs = {
    apt: {
      packages: ["lsof", "net-tools", "unzip", "wget", "ufw", "sudo", "curl", "git", "ca-certificates", "gnupg", "lsb-release", "xz-utils", "iproute2"],
    },
    docker: {
      packageName: "docker.io",
    },
    sftp: {
      root: "/www/wwwroot/extends-ssh",
    },
    nginx: {
      // 当前服务器采用宝塔 Nginx 布局，属于现有环境路径，不是 FHS 默认路径。
      root: "/www/server/panel/vhost/nginx",
      binary: "/www/server/nginx/sbin/nginx",
      config: "/www/server/nginx/conf/nginx.conf",
    },
    nodejs: {
      root: "/opt/node-v22.23.2-linux-x64",
      globalBin: "/usr/local/bin",
      packageVersion: "22.23.2",
      aptPackages: ["curl", "ca-certificates", "tar", "xz-utils", "coreutils"],
      tempRoot: "/tmp",
    },
    letsencrypt: {
      root: "/etc/letsencrypt",
      certificates: "/etc/extends-ssh/certificates",
      renewalHooks: "/etc/letsencrypt/renewal-hooks/deploy",
      aptPackages: ["certbot", "python3-certbot-nginx"],
      live: "/etc/letsencrypt/live",
    },
    frp: {
      root: "/opt/frp",
      binary: "/usr/local/bin/frps",
      config: "/etc/frp/frps.toml",
      log: "/var/log/frps.log",
      packageVersion: "0.70.1",
      systemdDirectory: "/etc/systemd/system",
    },
    peerjs: {
      imageName: "peerjs/peerjs-server",
      packageVersion: "1.0.2",
      key: "peerjs",
      listenPort: 9000,
      pathname: "/peerjs",
    },
    pm2: {
      packageName: "pm2",
    },
    stunServer: {
      imageName: "coturn/coturn",
      // 未设置 packageVersion，由切片动态获取官方最新稳定镜像。
    },
    vpnMihomo: {
      root: "/etc/mihomo",
      binary: "/usr/local/bin/mihomo",
      config: "/etc/mihomo/config.yaml",
      aptPackages: ["ca-certificates", "curl", "gzip", "iproute2", "iptables", "python3", "python3-yaml"],
      systemdDirectory: "/etc/systemd/system",
    },
    kasmVnc: {
      releaseApi: "https://github.com/kasmtech/KasmVNC/releases/latest",
      packagePrefix: "kasmvncserver",
      serverAptPackages: ["python3", "openssl"],
      chromiumAptPackages: ["python3", "openbox", "openssl", "snapd", "libasound2t64", "libnss3", "libatk-bridge2.0-0", "libgtk-3-0", "libgbm1", "libxss1", "libu2f-udev", "libvulkan1"],
      chromiumSnapPackage: "chromium",
      wechatAptPackages: ["openssl", "curl", "openbox", "libegl1", "libgbm1", "libgl1", "libpulse0", "libasound2t64", "libxkbcommon0", "libxkbcommon-x11-0", "libxcb-xinerama0"],
      wechatPackageUrl: "https://dldir1v6.qq.com/weixin/Universal/Linux/WeChatLinux_x86_64.deb",
      desktopAptPackages: ["xfce4", "thunar", "dbus-x11", "openssl"],
      httpdRoot: "/opt/extends-ssh/kasmvnc-www",
      packageWebRoot: "/usr/share/kasmvnc/www",
      chromiumBinary: "/snap/chromium/current/usr/lib/chromium-browser/chrome",
      chromiumExtensionRoot: "/opt/extends-ssh/chromium-extension",
      chromiumDataRoot: "/var/lib/kasm-vnc/chromium",
      chromiumTargetRoot: "/var/lib/kasm-vnc/chromium-target",
      wechatBinary: "/opt/wechat/wechat",
      wechatDataRoot: "/var/lib/kasm-vnc/wechat/.xwechat",
      wechatFilesRoot: "/var/lib/kasm-vnc/wechat/xwechat_files",
      desktopDataRoot: "/var/lib/kasm-vnc/desktop",
      sslCertificateRoot: "/etc/ssl/certs",
      sslPrivateKeyRoot: "/etc/ssl/private",
      systemdDirectory: "/etc/systemd/system",
      vncBinary: "/usr/bin/vncserver",
      homeRoot: "/home",
      runtimeRoot: "/run",
    },
  } as const;

  protected get domain(): string {
    return store.getState().public.domain;
  }

  // 内部健康钩子，仅由 setupReady 调用。
  protected abstract setup(): Promise<void>;
  // 内外部统一通过 setupReady 确保切片可用。全新服务器也确保服务正常运行
  setupReady(): Promise<void> {
    let task = setupTasks.get(this);
    if (!task) {
      task = Promise.resolve().then(() => this.setup()).catch(error => {
        setupTasks.delete(this);
        throw error;
      });
      setupTasks.set(this, task);
    }
    return task;
  }
}
