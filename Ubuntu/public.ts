import store from "extends-ssh/Ubuntu/store.ts";
import { NodeSSH, type SSHExecCommandResponse } from "node-ssh";

export default class Public {
  public readonly ssh = new NodeSSH();
  private readonly data = {
    connected: false,
  };

  /** 确保当前实例持有经过远程命令验证的 SSH 会话。 */
  public async sshIsRunning(): Promise<void> {
    if (this.data.connected) {
      try {
        const result = await this.ssh.execCommand("true");
        if (result.code === 0) return;
      } catch {
        this.ssh.dispose();
      }
        this.data.connected = false;
    }
    await this.ssh.connect(store.getState().ssh);
    const result = await this.ssh.execCommand("true");
    if (result.code !== 0) {
      this.ssh.dispose();
      throw new Error(`SSH 连接验证失败 (${String(result.code)})`, {
        cause: result.stderr || result.stdout,
      });
    }
    this.data.connected = true;
  }

  /** 执行远程命令并交付包含输出和退出码的成功结果。 */
  public async execute(command: string): Promise<SSHExecCommandResponse> {
    await this.sshIsRunning();
    const result = await this.ssh.execCommand(command);
    if (result.code !== 0) {
      throw new Error(`远程命令失败 (${String(result.code)})\n${result.stderr || result.stdout}`);
    }
    return result;
  }

  /** 确保远程服务器拥有可用且随系统启动的 PM2 daemon。 */
  public async pm2IsRunning(): Promise<void> {
    await this.execute(`
set -e
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo '远程服务器缺少 Node.js 与 npm' >&2
  exit 1
fi
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
pm2 ping >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null
systemctl enable pm2-root >/dev/null
`);
  }

  /** 关闭当前实例持有的 SSH 会话。 */
  public dispose(): void {
    this.ssh.dispose();
    this.data.connected = false;
  }
}
