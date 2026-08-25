import mcpserver from "mcpserver";
import ubuntu from "ubuntu-lib/index.ts";
import {
  dependenciesRemoteInstallValidator,
  deploymentPackageCreateValidator,
} from "ubuntu-lib/Nodejs/index.ts";
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

export default mcpserver.register.slice("nodejs")
  .tool(
    "post",
    "/ensure",
    emptyValidator,
    "检查远端 Node.js，缺少时完成安装与可用性验证。",
    mutate,
    async context => {
      await ubuntu.nodejs.isRemoteRunning();
      return context.json({ ready: true });
    },
  )
  .tool(
    "post",
    "/deploymentPackageCreate",
    deploymentPackageCreateValidator,
    "根据本地构建产物生成远端安装使用的生产 package.json。",
    read,
    async context => {
      const { buildPath, projectPath } = context.req.valid("json");
      return context.json(await ubuntu.nodejs.deploymentPackageCreate(buildPath, projectPath));
    },
  )
  .tool(
    "post",
    "/dependenciesRemoteInstall",
    dependenciesRemoteInstallValidator,
    "在明确的远端 Node.js 项目目录安装生产依赖。",
    mutate,
    async context => {
      await ubuntu.nodejs.dependenciesRemoteInstall(context.req.valid("json").projectPath);
      return context.json({ installed: true });
    },
  );
