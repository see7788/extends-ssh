import store from "../store.ts";

const setupTasks = new WeakMap<object, Promise<void>>();

export default abstract class {
  // 各切片共用的基础环境定义：固定路径与软件版本集中维护。
  // 未配置固定版本的软件由对应切片按官方渠道动态获取最新稳定版。
  // 实例参数派生的目录（如 /home/<user>、/run/kasm-vnc-<index>）由切片自行生成。
  //opt第三方软件、独立项目
  //etc系统配置
  //var运行时变化的数据
  //home普通用户文件
  //usr系统软件和共享资源
  //usr/local管理员本地安装的软件和共享资源
  //usr/bin用户命令程序
  //usr/sbin系统管理命令程序
  //usr/lib系统程序和软件包使用的共享库
  //usr/share与体系结构无关的共享数据
  //bin基本用户命令（现代Ubuntu通常链接到/usr/bin）
  //sbin系统管理命令（现代Ubuntu通常链接到/usr/sbin）
  //lib基本系统程序使用的共享库（现代Ubuntu通常链接到/usr/lib）
  //boot系统启动所需的引导文件、内核和初始化文件
  //dev设备文件，表示系统中的硬件和虚拟设备
  //proc进程及内核信息的虚拟文件系统
  //sys设备、驱动和内核信息的虚拟文件系统
  //root系统管理员root用户的主目录
  //tmp临时文件，通常不保证重启后保留
  //run系统运行期间的状态数据、PID文件和Socket
  //srv当前系统提供的服务所使用的数据
  //mnt管理员临时挂载文件系统的位置
  //media可移动存储设备的自动挂载位置
  //lost+found文件系统检查和修复时用于存放恢复文件
  //www宝塔面板常用目录，属于面板约定，不属于Linux标准FHS目录
  protected readonly envs = {
    apt: {
      packages: ["lsof", "net-tools", "unzip", "wget", "ufw", "sudo", "curl", "git", "ca-certificates", "gnupg", "lsb-release", "xz-utils", "iproute2"],
    },
    docker: {
      packageName: "docker.io",
    },
    sftp: {
      root: "/www/wwwroot/",
    },
    nginx: {
      // 当前服务器采用宝塔 Nginx 布局，属于现有环境路径，不是 FHS 默认路径。
      root: "/www/server/panel/vhost/nginx",
      binary: "/www/server/nginx/sbin/nginx",
      config: "/www/server/nginx/conf/nginx.conf",
      httpPort: 80,
      httpsPort: 443,
      tlsProtocols: ["TLSv1.2", "TLSv1.3"],
    },
    nodejs: {
      root: "/opt/node-v22.23.2-linux-x64",
      globalBin: "/usr/local/bin",
      packageVersion: "22.23.2",
      aptPackages: ["curl", "ca-certificates", "tar", "xz-utils", "coreutils"],
      architecture: "linux-x64",
      sha256: "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307",
      tempRoot: "/tmp",
    },
    letsencrypt: {
      root: "/etc/letsencrypt",
      certificates: "/etc/extends-ssh/certificates",
      renewalHooks: "/etc/letsencrypt/renewal-hooks/deploy",
      aptPackages: ["certbot", "python3-certbot-nginx"],
      live: "/etc/letsencrypt/live",
      renewalCheckSeconds: 2_592_000,
    },
    frp: {
      root: "/opt/frp",
      binary: "/usr/local/bin/frps",
      config: "/etc/frp/frps.toml",
      log: "/var/log/frps.log",
      packageVersion: "0.70.1",
      service: "frps.service",
      serverPort: 7000,
      vhostHTTPPort: 8080,
      proxyBindAddr: "127.0.0.1",
      logLevel: "info",
      logMaxDays: 7,
      restartSec: 5,
      systemdDirectory: "/etc/systemd/system",
    },
    peerjs: {
      imageName: "peerjs/peerjs-server",
      packageVersion: "1.0.2",
      containerName: "peerjs",
      key: "peerjs",
      listenPort: 9000,
      pathname: "/peerjs",
    },
    pm2: {
      packageName: "pm2",
    },
    stunServer: {
      imageName: "coturn/coturn",
      port: 3478,
      containerName: "coturn",
      restartPolicy: "unless-stopped",
      mode: "stun-only",
      // 未设置 packageVersion，由切片动态获取官方最新稳定镜像。
    },
    vpnMihomo: {
      root: "/etc/mihomo",
      binary: "/usr/local/bin/mihomo",
      config: "/etc/mihomo/config.yaml",
      aptPackages: ["ca-certificates", "curl", "gzip", "iproute2", "iptables", "python3", "python3-yaml"],
      systemdDirectory: "/etc/systemd/system",
      releaseApi: "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest",
      assetPrefix: "mihomo-linux-amd64",
      service: "cloud-mihomo.service",
      restartSec: 3,
      mixedPort: 7890,
      socksPort: 7891,
      redirPort: 7892,
      externalController: "127.0.0.1:9090",
      dnsListen: "127.0.0.1:7895",
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
      sslCertificateValidityDays: 3650,
      systemdDirectory: "/etc/systemd/system",
      vncBinary: "/usr/bin/vncserver",
      servicePrefix: "cloud-kasm-",
      userNames: { chromium: "chromium-browser", wechat: "wechat", desktop: "kasm-desktop" },
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
