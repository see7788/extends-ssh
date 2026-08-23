import mcpserver from "mcpserver";
import ubuntu from "./ubuntu/index";
import ubuntuRemote from "./ubuntuRemote/index";

export default mcpserver.packageImport({
  packageName: "ubuntu-mcpserver",
  description: "为 Ubuntu 项目提供项目检查、依赖维护、远程部署与服务管理工具。",
  RegisterAny: [ubuntu, ubuntuRemote],
});
