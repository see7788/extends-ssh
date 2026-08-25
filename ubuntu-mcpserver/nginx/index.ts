import mcpserver from "mcpserver";
import ubuntu from "ubuntu-lib/index.ts";
import {
  proxyRouteIsRunningValidator,
  routeCloseValidator,
  staticRouteIsRunningValidator,
} from "ubuntu-lib/Nginx/index.ts";
import { z } from "zod";

const emptyValidator = z.object({}).strict();
const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const mutate = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export default mcpserver.register.slice("nginx")
  .tool(
    "post",
    "/state",
    emptyValidator,
    "读取 Nginx 的公开访问状态。",
    read,
    context => context.json(ubuntu.nginx.state),
  )
  .tool(
    "post",
    "/ensure",
    emptyValidator,
    "检查远端 Nginx，缺少时完成安装与基础配置。",
    mutate,
    async context => {
      await ubuntu.nginx.isRemoteRunning();
      return context.json({ ready: true });
    },
  )
  .tool(
    "post",
    "/proxyRouteIsRunning",
    proxyRouteIsRunningValidator,
    "写入并启用一个明确域名、路径与目标端口的 Nginx 反向代理路由。",
    mutate,
    async context => {
      await ubuntu.nginx.proxyRouteIsRunning(context.req.valid("json"));
      return context.json({ configured: true });
    },
  )
  .tool(
    "post",
    "/staticRouteIsRunning",
    staticRouteIsRunningValidator,
    "写入并启用一个明确域名、路径与静态目录的 Nginx 静态资源路由。",
    mutate,
    async context => {
      await ubuntu.nginx.staticRouteIsRunning(context.req.valid("json"));
      return context.json({ configured: true });
    },
  )
  .tool(
    "post",
    "/routeClose",
    routeCloseValidator,
    "关闭并移除一个明确名称与域名的 Nginx 路由。",
    mutate,
    async context => {
      await ubuntu.nginx.routeClose(context.req.valid("json"));
      return context.json({ closed: true });
    },
  );
