# ubuntu-lib

## 结构

```text
public/
  index.ts             远程服务生命周期基类
  store.ts             公共域名配置
posts/
  store.ts             全局端口所有权数据
  index.ts             全局端口注册判断
ssh/
  index.ts             SSH 连接和远程命令能力
<service>/
  index.ts             独立业务类
  zod.ts              Zod 运行时校验器（如有）
  mcpserver.ts        MCP 工具注册（如有）
vite/
  Base.ts              Vite producer 组合器
```

## Store 边界

`*/store.ts` 只负责本切片的持久化数据和状态初始化；`store/index.ts` 只负责组合切片并持久化，不能承载业务方法。

业务状态的读取和写入只允许出现在对应业务 `index.ts` 或消费类中。跨切片读取也必须由实际消费它的业务类完成，`mcpserver.ts`、切片 `store.ts` 和组合入口不直接消费 store。类外部只使用类公开的方法和成员，不暴露切片后台状态对象。

## 远程服务生命周期

业务类继承 `public/index.ts` 的匿名默认基类：

```ts
export default class extends Base {
  protected async setup(): Promise<void> {
    // 安装或检查服务依赖
  }

  async makeRemote() {
    await this.setupReady();
  }
}
```

`setupReady()` 只缓存初始化 Promise。初始化失败时会清除缓存，下一次调用可以重试。业务结果由具体方法返回，不通过基类泛型或初始化函数返回。

`Ssh` 是业务类的公共依赖，业务类保持独立并直接创建所需的 `Ssh`、Docker、Nodejs 等依赖。业务类不继承 `Ssh`。

## 端口注册

`posts/store.ts` 只保存持久化的 `posts` 数据；`posts/index.ts` 提供 `portUse()`，按 owner 判断端口是否已经注册。端口注册和远程服务生命周期分开管理。

## MCP

每个业务目录的 `mcpserver.ts` 负责创建业务类实例、读取同目录 `zod.ts` 的校验器并注册工具。业务 `index.ts` 不包含 MCP 注册代码。

根级 `mcpserver.ts` 聚合各业务 MCP 切片，`slices.ts` 保留兼容入口。
