import mcpserver from "mcpserver";
import ubuntu from "./index.ts";
import { viteSlice } from "./Vite/index.ts";

export default mcpserver.register
  .register(viteSlice(ubuntu.vite))
  .import({
    roomName: "ubuntu",
    description: "配置和交付 Ubuntu 上的 Vite 项目。",
  });
