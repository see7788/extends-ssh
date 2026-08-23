import mcpserver from "mcpserver";
import store from "../store";
import {
  blackboxUri,
  dependenciesInstallValidator,
  importsEnsureValidator,
  projectReadValidator,
  stateValidator,
} from "./store";

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const mutationAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
export default mcpserver.register({ sliceName: "ubuntu" })
  .resource.register("get", "/readme", blackboxUri, {
    title: "Ubuntu Vite black-box contract",
    description: "Ubuntu Vite 公开组合接口的项目级黑盒说明。",
    mimeType: "text/markdown",
  }, async context => context.json(await store.getState().ubuntuActions.readme(context.req.query("uri"))))
  .tool.register("post", "/project/read", projectReadValidator, "识别一个具体 Vite 包，并返回必须先读的 Ubuntu Vite 黑盒及该项目适用的公开表达式。", readAnnotations, async context => context.json(
    await store.getState().ubuntuActions.projectRead(context.req.valid("json")),
  ))
  .tool.register("post", "/dependencies/install", dependenciesInstallValidator, "为具体 Node、Hono 或 Electron-Vite application 合并 ubuntu-lib 与 Vite peer dependency，并在该 package 目录执行 pnpm install。", mutationAnnotations, async context => {
    const result = await store.getState().ubuntuActions.dependenciesInstall(context.req.valid("json"));
    return result.status === 400 ? context.json(result.body, 400) : context.json(result.body);
  })
  .tool.register("post", "/imports/ensure", importsEnsureValidator, "为项目内已有 TypeScript 文件补齐 ubuntu-lib 的精确公开 import。", mutationAnnotations, async context => {
    const result = await store.getState().ubuntuActions.importsEnsure(context.req.valid("json"));
    return result.status === 400 ? context.json(result.body, 400) : context.json(result.body);
  })
  .tool.register("post", "/state", stateValidator, "按固定 Vite 服务端口返回公开的 HTTPS 访问状态，不返回连接或部署凭据。", readAnnotations, context => context.json(
    store.getState().ubuntuActions.state(context.req.valid("json")),
  ));
