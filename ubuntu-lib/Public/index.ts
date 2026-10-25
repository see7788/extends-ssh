import store from "../store/index.ts";
//T是能力类的public成员
//Base.remoteIsRunning 和 Base.portUse 属于基类公共接口，不包含在 T 中。
//task的返回值实际上是return this  
//一个具体子类可能消费许多端口，但必然自由一个主端口，子类按需对外提供portUse的返回值
export default abstract class Base<T> {
  //portUse分配全局资源
  //key是全局不重复值，通常用本地绝对路径|包名称
  //资源服务title、进程title、子域名、源码、缓存、日志、静态资源，等等一切，全部围绕端口号分配

  async portUse(port: number, key: string) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new RangeError(`Invalid port: ${port}`);
    }

    const ownerKey = key.trim();
    if (!ownerKey) {
      throw new TypeError("The port resource key cannot be empty");
    }

    const state = store.getState();
    const domain = state.domain.trim();
    if (!domain) {
      throw new Error("The public domain is not configured");
    }

    const current = state.prots[port];
    if (current && current.key !== ownerKey) {
      throw new Error(`Port ${port} is already owned by ${current.key}`);
    }

    if (!current) {
      store.setState((draft) => {
        draft.prots[port] = { key: ownerKey };
      });
    }

    return {
      ownerKey,
      port,
      domain,
      service: `/srv/service/${port}`,//服务部署资源
      src: `/srv/src/${port}`,//源代码
      www: `/srv/www/${port}`,//静态资源
      data: `/var/lib/data/${port}`,//持久化数据
      config: `/etc/config/${port}`,//服务配置
      cache: `/var/cache/${port}`,//运行时缓存
      log: `/var/log/${port}`,//日志
      runtime: `/run/${port}`,//运行时文件
      ssl: `/etc/ssl/${port}`,//证书和私钥
      serviceTitle: port,//服务名称
      dockerTitle: port,//docker进程名称
      pm2Title: port,//pm2进程名称
      subdomain: `${port}.${domain}`//子域名
    } as const
  }
  private current?: T;
  private currentPromise?: Promise<T>;

  protected abstract task(): Promise<T>;

  async remoteIsRunning(): Promise<T> {
    if (this.currentPromise) {
      this.current = await this.currentPromise;
    } else {
      this.currentPromise = this.task();
      this.current = await this.currentPromise;
    }
    return this.current;
  }
}
