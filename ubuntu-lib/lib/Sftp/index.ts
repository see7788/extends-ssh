import { isAbsolute, posix } from "node:path";
import mcpserver from "mcpserver";
import { z } from "zod";

import store from "../store/index.ts";
import { ssh } from "../Ssh/index.ts";
import { remoteRootValidator } from "./store.ts";

const devPortValidator = z.number().int().min(1).max(9_999);



const makeRemoteValidator = z.object({
  port: devPortValidator,
  localPath: z.string().trim().min(1).refine(isAbsolute, "localPath 必须是绝对路径"),
}).strict();
const getRemoteValidator = z.object({ port: devPortValidator }).strict();
type Remote = {
  readonly path: string;
  hasRemote(): Promise<boolean>;
};

class Sftp {
  private runningPromise?: Promise<void>;
  private readonly operations = new Map<number, Promise<void>>();
  private remoteIsRunning(): Promise<void> {
    if (this.runningPromise) return this.runningPromise;
    const promise = ssh.remoteIsRunning().finally(() => {
      if (this.runningPromise === promise) this.runningPromise = undefined;
    });
    this.runningPromise = promise;
    return promise;
  }
  public async getRemote(port: number): Promise<Remote> {
    const value = getRemoteValidator.parse({ port });
    if (!await this.hasRemote(value.port)) {
      throw new Error(`开发端口尚未分配 SFTP 远程目录: ${value.port}`);
    }
    return this.remote(value.port);
  }
  public async hasRemote(port: number): Promise<boolean> {
    const value = getRemoteValidator.parse({ port }).port;
    const remotePath = this.remotePath(value);
    await this.remoteIsRunning();
    const markerPath = posix.join(remotePath, ".extends-ssh-port");
    const result = await ssh.execute(`test -f ${this.shell(markerPath)} && cat ${this.shell(markerPath)} || true`);
    return result.stdout.trim() === String(value);
  }
  public async makeRemote(input: z.infer<typeof makeRemoteValidator>): Promise<Remote> {
    const value = makeRemoteValidator.parse(input);
    const current = this.operations.get(value.port);
    if (current) {
      await current;
      return this.remote(value.port);
    }
    const operation = this.makeRemoteEnsure(value).finally(() => {
      if (this.operations.get(value.port) === operation) this.operations.delete(value.port);
    });
    this.operations.set(value.port, operation);
    await operation;
    return this.remote(value.port);
  }
  private async makeRemoteEnsure(value: z.infer<typeof makeRemoteValidator>): Promise<void> {
    await this.remoteIsRunning();
    const remotePath = this.remotePath(value.port);
    const key = String(value.port);
    const markerPath = posix.join(remotePath, ".extends-ssh-port");
    const marker = await ssh.execute(`if [ -e ${this.shell(remotePath)} ]; then if [ -f ${this.shell(markerPath)} ]; then cat ${this.shell(markerPath)}; else printf __occupied__; fi; fi`);
    const owner = marker.stdout.trim();
    if (owner === "__occupied__") throw new Error(`远程目录已被其他资源占用: ${remotePath}`);
    if (owner && owner !== key) throw new Error(`远程目录已被开发端口 ${owner} 占用: ${remotePath}`);
    const uploaded = await ssh.client.putDirectory(value.localPath, remotePath, { recursive: true, validate: () => true });
    if (!uploaded) throw new Error(`远程目录同步失败: ${remotePath}`);
    await ssh.execute(`printf %s ${this.shell(key)} > ${this.shell(markerPath)}`);
  }

  private remote(port: number): Remote {
    const value = getRemoteValidator.parse({ port }).port;
    return {
      path: this.remotePath(value),
      hasRemote: () => this.hasRemote(value),
    };
  }

  private shell(value: string): string {
    return `'${value.replace(/'/g, `\'"'"'`)}'`;
  }
  private remotePath(port: number): string {
    const state = store.getState().sftp;
    const root = remoteRootValidator.parse(state.remoteRoot);
    return posix.join(root, `app-${port}`);
  }
}

export const sftp = new Sftp();

export default mcpserver.metas("/sftp")
  .add({ protocol: "tool", path: "/makeRemote", description: "按开发端口建立并首次同步远程应用目录。", schema: makeRemoteValidator.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await sftp.makeRemote(input); return { path: remote.path }; } })
  .add({ protocol: "tool", path: "/hasRemote", description: "检查开发端口对应的远程应用目录是否已分配。", schema: getRemoteValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => ({ hasRemote: await sftp.hasRemote(input.port) }) })
  .add({ protocol: "tool", path: "/getRemote", description: "检查并读取开发端口对应的远程应用目录。", schema: getRemoteValidator.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, handler: async input => { const remote = await sftp.getRemote(input.port); return { path: remote.path }; } });






