# ubuntu-lib

## 入口和目录

`package.json` 暴露两个入口：

- `.`：`index/index.ts`
- `./slices`：`slices.ts`

业务能力按切片目录组织：

```text
public/
  index.ts             远程服务生命周期基类
  store.ts             公共配置
store.ts               全局 Zustand store 和 Store 类型
posts/
  index.ts             端口占用注册
  store.ts             运行时端口所有权
<service>/
  index.ts             业务类
  store.ts             本切片配置或运行时状态（如有）
  zod.ts               MCP 运行时校验器（如有）
  mcpserver.ts         本切片 MCP 工具注册（如有）
vite/
  index.ts             Vite 状态合并和文件写入插件
```

`vite/Base.ts` 是停用的历史代码注释，不参与当前实现。

## Store 边界

每个切片的 `store.ts` 只定义本切片的持久化配置或运行时状态。根目录 `store.ts` 负责：

- 导入并组合所有切片 store；
- 直接内联全局 store 类型；
- 通过 `cwdPersist` 持久化状态。

业务类在自己的 `index.ts` 或消费类中读取和写入状态。跨切片消费通过对应业务类的公开能力完成，不直接读取其他切片的 store。MCP 注册文件只创建业务类实例并注册工具，不直接消费 store。

`posts` 和 `vite` 保存的是运行时状态，不是业务配置：`posts` 管理端口所有权，`vite` 管理 Vite 插件合并后的定义。

## 远程服务生命周期

业务类继承 `public/index.ts` 的匿名默认基类：

```ts
export default class extends Base {
  protected async setup(): Promise<void> {
    // 准备或检查远程依赖
  }
}
```

`setupReady()` 只缓存一次初始化 Promise；初始化失败会清除缓存，后续调用可以重试。业务类保持独立，按需直接创建 `Ssh`、`Docker`、`Nodejs` 等依赖，不继承这些依赖类。

配置修改由具体业务类提供方法，并从 store 读取配置。例如：

- `kasmVnc`：`setup(index)`、`set(index)`、`add(index)`、`stop(index)`、`del(index)` 和共享的 `vitePlugin()`；store 按 `server`、`chromium`、`wechat`、`desktop` 保存安装配置，运行实例统一放在 `instances`，KasmVNC Web 前端目录由 `server.httpdDirectory` 统一配置，Chromium 的 `appMode` 控制应用窗口和普通多标签页模式。
- `stunServer`：`setup()` 和 `update()`。
- `vpnMihomo`：`setup()`、`set()` 和 `stop()`；`set()` 会下载订阅基础配置，再应用 store 配置并重启服务。

## 端口注册

`posts/index.ts` 的 `portUse(port, ownerKey)` 负责全局端口所有权判断。端口所有权记录保存在 `posts` store，与具体远程服务的启动和关闭分开管理。

## Vite 插件

`vite/index.ts` 负责：

- 将业务定义合并到对应开发端口的 Vite 状态；
- 提供最早执行的 `mergeStatePlugin`；
- 提供最晚执行的 `writeFilePlugin`，把合并后的定义写入项目文件。

各业务切片自己创建并消费 Vite 插件，不再通过已停用的 `vite/Base.ts` 组合器工作。

## MCP

每个业务目录的 `mcpserver.ts` 负责创建业务类实例、引用同目录的 Zod 校验器并注册工具。根级聚合入口是 `slices.ts`，它通过 `baseAdd` 组合所有业务 MCP 切片；当前没有单独的根 `mcpserver.ts`。
