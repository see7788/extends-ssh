import net from "node:net";
import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
const localShellStore: ImmerStateCreator<{
  localShellActions: {
    hasPort(port: number): Promise<boolean>;
  }
}> = () => ({
  localShellActions: {
    hasPort(port: number): Promise<boolean> {
      return new Promise((resolve, reject) => {
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          reject(new Error(`本地端口必须是 1-65535 的整数: ${String(port)}`));
          return;
        }
        const server = net.createServer();
        server.once("error", error => {
          if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") resolve(true);
          else reject(error);
        });
        server.listen(port, "127.0.0.1", () => {
          server.close(error => {
            if (error) reject(error);
            else resolve(false);
          });
        });
      });
    },
  }
});

export default localShellStore;