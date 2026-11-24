import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const kasmVncStore: ImmerStateCreator<{
  kasmVnc: {
    readonly instances: Array<{
      readonly application:
      | {
        readonly type: "chromium"; // 承载 Chromium 浏览器
        readonly url: string; // 启动后打开的目标地址
        readonly noSandbox: boolean; // true=禁用沙箱；false=保留沙箱
        readonly disableDevShmUsage: boolean; // true=禁用 /dev/shm；false=使用 /dev/shm
        readonly disableGpu: boolean; // true=禁用 GPU；false=启用 GPU
        readonly noFirstRun: boolean; // true=跳过首次运行向导；false=显示首次运行向导
        readonly noDefaultBrowserCheck: boolean; // true=跳过默认浏览器检查；false=执行默认浏览器检查
        readonly appMode: boolean; // true=应用窗口模式，不显示普通标签栏；false=普通多标签页
        readonly kiosk: boolean; // true=启动全屏 Kiosk 模式；false=普通窗口模式
      }
      | {
        readonly type: "wechat"; // 承载 Linux 微信
      }
      | {
        readonly type: "desktop"; // 启动 XFCE 和 Thunar 远程桌面
      };
      readonly basicAuth: // KasmVNC Web BasicAuth 配置
      | {
        readonly enabled: false; // 关闭账号密码登录，不需要其他认证参数
      }
      | {
        readonly enabled: true; // 开启账号密码登录
        readonly username: string; // Web 登录用户名
        readonly password: string; // Web 登录密码
      };
      readonly port: number; // WebSocket 对外监听端口
      readonly display: `:${number}`; // X 显示编号
      readonly resolution: { // 远程桌面分辨率
        readonly width: number; // 桌面宽度
        readonly height: number; // 桌面高度
      };
      readonly pixelDepth: number; // 桌面像素位深
      readonly allowResize: boolean; // true=允许调整分辨率；false=固定分辨率
      readonly networkProtocol: "http" | "https"; // 网络协议
      readonly networkInterface: string; // 网络监听地址
      readonly networkUseIpv4: boolean; // true=启用 IPv4；false=禁用 IPv4
      readonly networkUseIpv6: boolean; // true=启用 IPv6；false=禁用 IPv6
      readonly userSessionConcurrentConnectionsPrompt: boolean; // true=多连接时提示；false=不提示
      readonly userSessionIdleTimeout: string; // 会话空闲超时时间
      readonly commandLinePrompt: boolean; // true=显示命令行提示；false=隐藏命令行提示
      readonly sslOnly: boolean; // true=仅使用 SSL；false=允许非 SSL
      readonly alwaysShared: boolean; // true=始终允许共享；false=按会话设置共享
      readonly localhost: boolean; // true=仅监听本机；false=允许外部访问
      readonly systemd: { // systemd 可变参数
        readonly restart: "always" | "on-failure" | "no"; // 服务重启策略
        readonly restartSec: number; // 重启等待秒数
      };
    }>;
  };
}> = () => ({
  kasmVnc: {
    instances: [
      {
        application: {
          type: "chromium",
          url: "https://chromewebstore.google.com/?utm_source=ext_app_menu",
          noSandbox: true,
          disableDevShmUsage: true,
          disableGpu: true,
          noFirstRun: true,
          noDefaultBrowserCheck: true,
          appMode: true,
          kiosk: true,
        },
        port: 10_003,
        display: ":1",
        resolution: { width: 1_440, height: 900 },
        pixelDepth: 24,
        allowResize: true,
        networkProtocol: "http",
        networkInterface: "0.0.0.0",
        networkUseIpv4: true,
        networkUseIpv6: false,
        userSessionConcurrentConnectionsPrompt: false,
        userSessionIdleTimeout: "never",
        commandLinePrompt: false,
        basicAuth: {
          enabled: false,
        },
        sslOnly: false,
        alwaysShared: true,
        localhost: false,
        systemd: {
          restart: "always",
          restartSec: 3,
        },
      }, {
        application: {
          type: "wechat",
        },
        port: 10_004,
        display: ":2",
        resolution: { width: 1_440, height: 900 },
        pixelDepth: 24,
        allowResize: true,
        networkProtocol: "http",
        networkInterface: "0.0.0.0",
        networkUseIpv4: true,
        networkUseIpv6: false,
        userSessionConcurrentConnectionsPrompt: false,
        userSessionIdleTimeout: "never",
        commandLinePrompt: false,
        basicAuth: {
          enabled: true,
          username: "111",
          password: "222222",
        },
        sslOnly: false,
        alwaysShared: true,
        localhost: false,
        systemd: {
          restart: "always",
          restartSec: 3,
        },
      }, {
        application: {
          type: "desktop",
        },
        port: 10_005,
        display: ":3",
        resolution: { width: 1_440, height: 900 },
        pixelDepth: 24,
        allowResize: true,
        networkProtocol: "http",
        networkInterface: "0.0.0.0",
        networkUseIpv4: true,
        networkUseIpv6: false,
        userSessionConcurrentConnectionsPrompt: false,
        userSessionIdleTimeout: "never",
        commandLinePrompt: false,
        basicAuth: {
          enabled: false,
        },
        sslOnly: false,
        alwaysShared: true,
        localhost: false,
        systemd: {
          restart: "always",
          restartSec: 3,
        },
      }],
  },
});

export default kasmVncStore;
