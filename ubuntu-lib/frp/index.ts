import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import Base from "../public/index.ts";
import store from "../store.ts";
import Nginx from "../nginx/index.ts";
import Vite from "../vite/index.ts";

type FrpProcess = {
  child: ChildProcessByStdio<null, Readable, Readable>;
  configDirectory: string;
  remotePort: number;
  stderr: string;
  closing: boolean;
};

export default class extends Base {
  private handle?: FrpProcess;

  constructor(private readonly port: number) {
    super();
  }

  vitePlugin(): Plugin {
    const nginx = new Nginx("forward", this.port);
    const vite = new Vite(this.port);
    return {
      name: `frpForwardPlugin${this.port}`,
      enforce: "pre",
      configResolved: async () => {
        vite.mergeState({
          frpForward: { url: nginx.url },
        });
      },
      configureServer: async server => {
        const start = async () => {
          const forward = await this.getRemote();
          await nginx.makeRemote();
          server.httpServer?.once("close", () => {
            void (async () => {
              await forward.close();
              await nginx.closeRemote();
            })().catch(error => {
              console.error("关闭 frp 转发和 Nginx 路由失败", error);
            });
          });
        };
        if (!server.httpServer || server.httpServer.listening) {
          await start();
          return;
        }
        server.httpServer.once("listening", () => {
          void start().catch(error => {
            console.error("启动 frp 转发和 Nginx 路由失败", error);
          });
        });
      },
    };
  }

  protected async setup(): Promise<void> {
    const { frp } = store.getState();
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65_535) {
      throw new Error(`frp 本地端口必须是 1-65535 的整数: ${String(this.port)}`);
    }
    if (!frp.serverAddr.trim()) {
      throw new Error("frp.serverAddr 未配置，请先在 frp store 中配置服务器地址");
    }
    if (!Number.isInteger(frp.serverPort) || frp.serverPort < 1 || frp.serverPort > 65_535) {
      throw new Error(`frp 服务端口必须是 1-65535 的整数: ${String(frp.serverPort)}`);
    }
    if (!frp.token) {
      throw new Error("frp.token 未配置，请先在 frp store 中配置认证 token");
    }
    await this.resolveClientBinary();
  }

  async makeRemote(): Promise<{ readonly remotePort: number; hasRemote(): Promise<boolean>; close(): Promise<void> }> {
    await this.setupReady();
    await this.ensureForward();
    return {
      remotePort: this.handle!.remotePort,
      hasRemote: () => this.hasRemote(),
      close: () => this.closeRemote(),
    };
  }

  async getRemote(): Promise<{ readonly remotePort: number; hasRemote(): Promise<boolean>; close(): Promise<void> }> {
    await this.setupReady();
    if (!await this.hasRemote()) {
      return this.makeRemote();
    }
    return {
      remotePort: this.handle!.remotePort,
      hasRemote: () => this.hasRemote(),
      close: () => this.closeRemote(),
    };
  }

  async hasRemote(): Promise<boolean> {
    await this.setupReady();
    return this.handle !== undefined
      && this.handle.child.exitCode === null
      && !this.handle.child.killed;
  }

  async closeRemote(): Promise<void> {
    const current = this.handle;
    if (!current) return;
    this.handle = undefined;
    current.closing = true;
    try {
      if (current.child.exitCode === null) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            current.child.kill("SIGKILL");
            reject(new Error(`关闭 frpc 超时: ${String(current.child.pid)}`));
          }, 10_000);
          current.child.once("close", () => {
            clearTimeout(timeout);
            resolve();
          });
          current.child.once("error", error => {
            clearTimeout(timeout);
            reject(error);
          });
          current.child.kill();
        });
      }
    } finally {
      await rm(current.configDirectory, { recursive: true, force: true });
    }
  }

  private async ensureForward(): Promise<void> {
    if (await this.hasRemote()) return;
    await this.closeRemote();
    const { frp } = store.getState();
    const clientBinary = await this.resolveClientBinary();
    const configDirectory = await mkdtemp(path.join(os.tmpdir(), "extends-ssh-frpc-"));
    const configPath = path.join(configDirectory, "frpc.toml");
    await writeFile(configPath, [
      `serverAddr = ${JSON.stringify(frp.serverAddr)}`,
      `serverPort = ${String(frp.serverPort)}`,
      `auth.method = "token"`,
      `auth.token = ${JSON.stringify(frp.token)}`,
      `transport.tls.enable = true`,
      `transport.protocol = "tcp"`,
      "",
      "[[proxies]]",
      `name = ${JSON.stringify(`extends-ssh-${this.port}`)}`,
      `type = "tcp"`,
      `localIP = "127.0.0.1"`,
      `localPort = ${String(this.port)}`,
      `remotePort = ${String(this.port)}`,
    ].join("\n"), { encoding: "utf8", mode: 0o600 });

    const child = spawn(clientBinary, ["-c", configPath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const current: FrpProcess = {
      child,
      configDirectory,
      remotePort: this.port,
      stderr: "",
      closing: false,
    };
    this.handle = current;
    child.stderr.on("data", chunk => {
      current.stderr += chunk.toString();
      if (current.stderr.length > 8_000) current.stderr = current.stderr.slice(-8_000);
    });
    child.once("exit", (code, signal) => {
      if (this.handle?.child === child) this.handle = undefined;
      if (code !== 0 && !current.closing) {
        console.error(`frpc 已退出 (${String(code ?? signal)})${current.stderr ? `\n${current.stderr}` : ""}`);
        void rm(current.configDirectory, { recursive: true, force: true }).catch(error => {
          console.error("清理异常退出的 frpc 配置失败", error);
        });
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", () => resolve());
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          reject(new Error(`frpc 启动后退出 (${String(code ?? signal)})${current.stderr ? `\n${current.stderr}` : ""}`));
        });
      });
      await new Promise(resolve => setTimeout(resolve, 300));
      if (child.exitCode !== null) {
        throw new Error(`frpc 启动后退出 (${String(child.exitCode)})${current.stderr ? `\n${current.stderr}` : ""}`);
      }
    } catch (error) {
      this.handle = undefined;
      child.kill();
      await rm(configDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  private async resolveClientBinary(): Promise<string> {
    const { frp } = store.getState();
    if (frp.clientBinary) {
      await this.assertClientBinary(frp.clientBinary);
      return frp.clientBinary;
    }
    try {
      await this.assertClientBinary("frpc");
      return "frpc";
    } catch (pathError) {
      try {
        return await this.downloadClientBinary();
      } catch (downloadError) {
        throw new Error(`找不到 frpc，PATH 检查失败：${String(pathError)}；自动下载失败：${String(downloadError)}`);
      }
    }
  }

  private async assertClientBinary(binary: string): Promise<void> {
    const result = await this.runProcess(binary, ["--version"]);
    if (result.code !== 0) {
      throw new Error(`${binary} --version 失败 (${String(result.code)}): ${result.stderr || result.stdout}`);
    }
  }

  private async downloadClientBinary(): Promise<string> {
    const { version } = store.getState().frp;
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : undefined;
    const architecture = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : undefined;
    if (!platform || !architecture) {
      throw new Error(`当前平台不支持自动下载 frpc: ${process.platform}/${process.arch}`);
    }
    const packageName = `frp_${version}_${platform}_${architecture}`;
    const extension = platform === "windows" ? "zip" : "tar.gz";
    const cacheDirectory = path.resolve(path.dirname(fileURLToPath(new URL("../package.json", import.meta.url))), ".extends-ssh", "frp");
    const binaryPath = path.join(cacheDirectory, `${packageName}-frpc${platform === "windows" ? ".exe" : ""}`);
    await mkdir(cacheDirectory, { recursive: true });
    let cacheError: unknown;
    try {
      await this.assertClientBinary(binaryPath);
      return binaryPath;
    } catch (error) {
      cacheError = error;
    }
    const archivePath = path.join(cacheDirectory, `${packageName}.${extension}`);
    const response = await fetch(`https://github.com/fatedier/frp/releases/download/v${version}/${packageName}.${extension}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`下载 frpc 失败: HTTP ${response.status}；缓存检查失败: ${String(cacheError)}`);
    }
    await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
    const extractDirectory = await mkdtemp(path.join(cacheDirectory, "extract-"));
    try {
      if (platform === "windows") {
        const quotePowerShell = (value: string) => `'${value.replaceAll("'", "''")}'`;
        const result = await this.runProcess("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(extractDirectory)} -Force`,
        ]);
        if (result.code !== 0) throw new Error(result.stderr || result.stdout);
      } else {
        const result = await this.runProcess("tar", ["-xzf", archivePath, "-C", extractDirectory]);
        if (result.code !== 0) throw new Error(result.stderr || result.stdout);
      }
      const extractedBinary = path.join(extractDirectory, packageName, platform === "windows" ? "frpc.exe" : "frpc");
      await copyFile(extractedBinary, binaryPath);
      if (platform !== "windows") await chmod(binaryPath, 0o755);
    } finally {
      await rm(extractDirectory, { recursive: true, force: true });
      await rm(archivePath, { force: true });
    }
    await this.assertClientBinary(binaryPath);
    return binaryPath;
  }

  private runProcess(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk.toString(); });
      child.stderr.on("data", chunk => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", code => resolve({ code, stdout, stderr }));
    });
  }
}
