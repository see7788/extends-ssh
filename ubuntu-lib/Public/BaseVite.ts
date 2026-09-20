import type { Plugin } from "vite";
import path from "node:path";
import store from "../store"

export default abstract class {
    abstract prot: number//内网穿透地址、sftp目录、服务器占用端口、子域名、本地开发端口
    constructor(protected projectPath: string) {
    }
    protected isRemoteRunning(): Promise<void> {
        //sftp上传store.getState()[this.prot].cwd， pm2运行，Nginx配子域名
        return {
            domain: store.getState().domain,
            ...store.getState().port[this.prot]
        }
    }
    //import.meta.dirname
    protected async register() {
        const cwd = store.getState().port[this.prot]?.cwd

        if (!cwd) {
            store.setState(s => {
                s.port[this.prot] = { cwd: this.projectPath, name, port: this.prot }
            })
        }
        if (cwd && path.normalize(cwd) !== this.projectPath) {
            throw Error(cwd + "项目已占用" + this.prot)
        }
    }
    protected setVitePort: Plugin<any>["config"] = (_config, environment) => {
        if (environment.command !== "serve") return
        return {
            server: {
                port: this.prot,
            },
        }
    }
    // async vitePluginBase(): Promise<Plugin<any>> {
    //     await this.isRemoteRunning()
    //     return {
    //         name: name + "-serverbase",
    //     }
    // }
    // async hono() {
    //     await this.isRemoteRunning()
    //     //hono 中间件jwt鉴权//可选实现
    //     //hono.get路由派发消费参数
    // }
}
