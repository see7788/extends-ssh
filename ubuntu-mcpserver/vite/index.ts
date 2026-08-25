import mcpserver from "mcpserver";
import ubuntu from "ubuntu-lib/index.ts";
import {
  dependenciesInstallValidator,
  importsEnsureValidator,
  projectReadValidator,
  readmeUri,
  stateValidator,
} from "ubuntu-lib/Vite/index.ts";

const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const localMutate = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const remoteMutate = {
  ...localMutate,
  openWorldHint: true,
} as const;

export default mcpserver.register.slice("vite")
  .resource(
    "get",
    "/readme",
    readmeUri,
    {
      title: "项目 README",
      description: "读取 Ubuntu Vite 项目接入说明。",
      mimeType: "text/markdown",
    },
    async context => context.json(
      await ubuntu.vite.readme(context.req.query("uri")),
    ),
  )
  .tool(
    "post",
    "/projectRead",
    projectReadValidator,
    "识别一个具体 Vite 应用，并返回适用的公开接入表达式。",
    read,
    async context => context.json(
      await ubuntu.vite.projectRead(context.req.valid("json")),
    ),
  )
  .tool(
    "post",
    "/dependenciesInstall",
    dependenciesInstallValidator,
    "为具体 Vite 应用补齐 Ubuntu Vite 依赖并安装依赖。",
    remoteMutate,
    async context => {
      const result = await ubuntu.vite.dependenciesInstall(
        context.req.valid("json"),
      );
      return result.status === 400
        ? context.json(result.body, 400)
        : context.json(result.body);
    },
  )
  .tool(
    "post",
    "/importsEnsure",
    importsEnsureValidator,
    "为项目内已有 TypeScript 文件补齐 Ubuntu Vite 的公开导入。",
    localMutate,
    async context => {
      const result = await ubuntu.vite.importsEnsure(
        context.req.valid("json"),
      );
      return result.status === 400
        ? context.json(result.body, 400)
        : context.json(result.body);
    },
  )
  .tool(
    "post",
    "/state",
    stateValidator,
    "按固定 Vite 服务端口读取公开 HTTPS 访问状态。",
    read,
    context => context.json(
      ubuntu.vite.state(context.req.valid("json").port),
    ),
  );
