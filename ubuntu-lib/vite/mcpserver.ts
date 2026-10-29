import mcpserver from "mcpserver";
import { z } from "zod";
import { getViteState, listViteState } from "./state.ts";

export default mcpserver.metas("/vite")
  .add({
    protocol: "tool",
    path: "/list",
    description: "读取已登记的 Vite 项目、开发端口、项目路径和 Vite 插件注入常量。",
    schema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: () => listViteState(),
  })
  .add({
    protocol: "tool",
    path: "/get",
    description: "按开发端口读取一个已登记的 Vite 项目状态。",
    schema: { port: z.number().int().min(1).max(65535) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: input => {
      const value = getViteState(input.port);
      if (!value) throw new Error(`未找到 Vite 开发端口: ${input.port}`);
      return value;
    },
  });
