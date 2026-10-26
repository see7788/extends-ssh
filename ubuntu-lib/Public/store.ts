import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

interface portBase_t {
  port: number,
  ownerKey: string,
}
interface portInfo_t {
  service: `/srv/service/${number}`,//服务部署资源
  src: `/srv/src/${number}`,//源代码
  www: `/srv/www/${number}`,//静态资源
  data: `/var/lib/data/${number}`,//持久化数据
  config: `/etc/config/${number}`,//服务配置
  cache: `/var/cache/${number}`,//运行时缓存
  log: `/var/log/${number}`,//日志
  runtime: `/run/${number}`,//运行时文件
  ssl: `/etc/ssl/${number}`,//证书和私钥
  serviceTitle: number,//服务名称
  dockerTitle: number,//docker进程名称
  pm2Title: number,//pm2进程名称
  subdomain: `${number}.${string}`//子域名
  define: Record<string, any>;//注入常量
}
const publicStore: ImmerStateCreator<{
  domain: string;
  prots: Record<number, portBase_t & Partial<portInfo_t>>;
}> = () => ({
  domain: "13520521413.store",
  prots: {},
});

export default publicStore;
