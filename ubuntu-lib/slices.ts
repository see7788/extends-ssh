import mcpserver from "mcpserver";
import Nginx from "./nginx/index.ts";
import SshForward from "./sshForward/index.ts";
import { inputValidator as sshForwardInputValidator } from "./sshForward/zod.ts";
import aptSlice from "./apt/mcpserver.ts";
import dockerSlice from "./docker/mcpserver.ts";
import kasmVncKasmSlice from "./kasmVnc/mcpserver.ts";
import certificateSlice from "./certificate/mcpserver.ts";
import sshForwardSlice from "./sshForward/mcpserver.ts";
import nginxSlice from "./nginx/mcpserver.ts";
import nodejsSlice from "./nodejs/mcpserver.ts";
import peerjsSlice from "./peerjs/mcpserver.ts";
import pm2Slice from "./pm2/mcpserver.ts";
import sftpSlice from "./sftp/mcpserver.ts";
import sshSlice from "./ssh/mcpserver.ts";
import stunServerSlice from "./stunServer/mcpserver.ts";
import vpnMihomoSlice from "./vpnMihomo/mcpserver.ts";
import viteSlice from "./vite/mcpserver.ts";

const debugForwards = new Map<number, SshForward>();
const sshForwardDebugSlice = mcpserver.metas("/debug")
  .add({
    protocol: "tool",
    path: "/sshForward",
    description: "临时调试指定端口的 SSH 内网穿透和 HTTPS Nginx 路由：依次建立远端端口转发与 Nginx 路由，并返回两段状态。",
    schema: sshForwardInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      let forward = debugForwards.get(input.port);
      if (!forward) {
        forward = new SshForward(input.port);
        debugForwards.set(input.port, forward);
      }
      const remote = await forward.getRemote();
      const nginx = new Nginx("sshForward", input.port);
      const route = await nginx.makeRemote();
      return {
        port: input.port,
        sshForward: { remotePort: remote.remotePort, hasRemote: await remote.hasRemote() },
        nginx: { url: route.url, hasRemote: await route.hasRemote() },
      };
    },
  })
  .add({
    protocol: "tool",
    path: "/sshForward/close",
    description: "临时调试接口的清理操作：关闭指定端口的 HTTPS Nginx 路由和 SSH 内网穿透。",
    schema: sshForwardInputValidator.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async input => {
      const nginx = new Nginx("sshForward", input.port);
      await nginx.closeRemote();
      const forward = debugForwards.get(input.port);
      if (forward) {
        await forward.closeRemote();
        debugForwards.delete(input.port);
      }
      return { port: input.port, closed: true };
    },
  });

export default mcpserver.metas("/")
  .baseAdd(sshForwardDebugSlice)
  .baseAdd(viteSlice)
  .baseAdd(aptSlice)
  .baseAdd(dockerSlice)
  .baseAdd(kasmVncKasmSlice)
  .baseAdd(certificateSlice)
  .baseAdd(sshForwardSlice)
  .baseAdd(nginxSlice)
  .baseAdd(nodejsSlice)
  .baseAdd(peerjsSlice)
  .baseAdd(pm2Slice)
  .baseAdd(sftpSlice)
  .baseAdd(sshSlice)
  .baseAdd(stunServerSlice)
  .baseAdd(vpnMihomoSlice)
  .import({ name: "ubuntu-lib", description: "单远程 Ubuntu 服务基础能力。" });
