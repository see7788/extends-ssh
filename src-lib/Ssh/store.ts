import type { ImmerStateCreator as immerStateCreator } from "extends-zustand/immerStateCreator";
import { NodeSSH, type SSHExecCommandResponse } from "node-ssh";

type SshSlice = {
  Ssh: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
  SshActions: {
    isRunning(): Promise<void>;
    execute(command: string): Promise<SSHExecCommandResponse>;
    runtime(): {
      client: NodeSSH;
      revision: number;
    };
    dispose(): void;
  };
};

const s: immerStateCreator<SshSlice> = (_set, get) => {
  const client = new NodeSSH();
  let connected = false;
  let revision = 0;
  let running: Promise<void> | undefined;

  const isRunning = (): Promise<void> => {
    if (running) return running;
    const execution = (async () => {
      if (connected) {
        try {
          if ((await client.execCommand("true")).code === 0) return;
        } catch {
          client.dispose();
        }
        connected = false;
      }
      await client.connect(get().Ssh);
      const verification = await client.execCommand("true");
      if (verification.code !== 0) {
        client.dispose();
        throw new Error(
          `SSH 连接验证失败 (${String(verification.code)}): ${verification.stderr || verification.stdout}`,
        );
      }
      connected = true;
      revision += 1;
    })().finally(() => {
      if (running === execution) running = undefined;
    });
    running = execution;
    return execution;
  };

  return {
    Ssh: {
      host: "82.156.162.242",
      port: 54321,
      username: "root",
      password: "9K78s98[98]j.9",
    },
    SshActions: {
      isRunning,
      async execute(command) {
        await isRunning();
        const execution = await client.execCommand(command);
        if (execution.code !== 0) {
          throw new Error(
            `远程命令失败 (${String(execution.code)})\n${execution.stderr || execution.stdout}`,
          );
        }
        return execution;
      },
      runtime: () => ({ client, revision }),
      dispose() {
        client.dispose();
        connected = false;
        revision += 1;
      },
    },
  };
};

export default s;
