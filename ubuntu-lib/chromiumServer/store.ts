import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

export type ChromiumServerConfig = {
  readonly chromium: { // Chromium 可变参数
    readonly url: string; // 启动后打开的目标地址
    readonly noSandbox: boolean; // 是否禁用沙箱
    readonly disableDevShmUsage: boolean; // 是否禁用 /dev/shm
    readonly disableGpu: boolean; // 是否禁用 GPU
    readonly noFirstRun: boolean; // 是否跳过首次运行向导
    readonly noDefaultBrowserCheck: boolean; // 是否跳过默认浏览器检查
    readonly kiosk: boolean; // 是否使用全屏 Kiosk 模式
  };
  readonly kasmVnc: { // KasmVNC 可变参数
    readonly port: number; // WebSocket 对外监听端口
    readonly display: string; // X 显示编号
    readonly resolution: { // 远程桌面分辨率
      readonly width: number; // 桌面宽度
      readonly height: number; // 桌面高度
    };
    readonly pixelDepth: number; // 桌面像素位深
    readonly allowResize: boolean; // 是否允许调整分辨率
    readonly networkProtocol: "http" | "https"; // 网络协议
    readonly networkInterface: string; // 网络监听地址
    readonly networkUseIpv4: boolean; // 是否启用 IPv4
    readonly networkUseIpv6: boolean; // 是否启用 IPv6
    readonly networkRequireSsl: boolean; // 是否强制 SSL
    readonly userSessionConcurrentConnectionsPrompt: boolean; // 多连接时是否提示
    readonly userSessionIdleTimeout: string; // 会话空闲超时时间
    readonly commandLinePrompt: boolean; // 是否显示命令行提示
    readonly disableBasicAuth: boolean; // 是否禁用 VNC 基本认证
    readonly securityTypes: string; // VNC 安全类型
    readonly sslOnly: boolean; // 是否仅使用 SSL
    readonly alwaysShared: boolean; // 是否始终允许共享
    readonly localhost: boolean; // 是否仅监听本机
  };
  readonly systemd: { // systemd 可变参数
    readonly restart: "always" | "on-failure" | "no"; // 服务重启策略
    readonly restartSec: number; // 重启等待秒数
  };
};

const chromiumServerStore: ImmerStateCreator<{
  chromiumServer: ChromiumServerConfig[];
}> = () => ({
  chromiumServer: [{
    chromium: {
      url: "https://github.com/",
      noSandbox: true,
      disableDevShmUsage: true,
      disableGpu: true,
      noFirstRun: true,
      noDefaultBrowserCheck: true,
      kiosk: true,
    },
    kasmVnc: {
      port: 10_003,
      display: ":1",
      resolution: { width: 1_440, height: 900 },
      pixelDepth: 24,
      allowResize: true,
      networkProtocol: "http",
      networkInterface: "0.0.0.0",
      networkUseIpv4: true,
      networkUseIpv6: false,
      networkRequireSsl: false,
      userSessionConcurrentConnectionsPrompt: false,
      userSessionIdleTimeout: "never",
      commandLinePrompt: false,
      disableBasicAuth: true,
      securityTypes: "None",
      sslOnly: false,
      alwaysShared: true,
      localhost: false,
    },
    systemd: {
      restart: "always",
      restartSec: 3,
    },
  }],
});

export default chromiumServerStore;
