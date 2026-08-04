import { createStore } from 'zustand';
import path, { join } from 'path';
import cwdPersist from "extends-zustand/cwdPersist"
import { immer } from "zustand/middleware/immer"
import { fileURLToPath } from "url"
const __filename = fileURLToPath(import.meta.url); // 当前文件的完整路径
type state_t = {
    sshConfig: {
        host: string,
        port: number,
        username: string,
        password: string,
    }
    peerServer_port: number,
    coturn_default_port: number,//Coturn默认非加密STUN/TURN端口（TCP/UDP共用）
    coturn_tls_port: number,//Coturn TLS加密STUN/TURN端口（TCP/UDP共用）
    coturn_relay_port_start: number,//Coturn TURN媒体中继端口起始值（仅UDP）
    peerjsIsRunning?: true
    coturnIsRunning?: true
    dockerIsRunning?: true
    httpserverIsInstalled?: true
    pm2IsRunning?: true
    emailSmtpIsRunning?: true
    nvmIsInstalled?: true
}
//github设置npm令牌https://github.com/see7788/testtaro/settings/secrets/actions
// 当前SSH类针对Ubuntu 22.04版本
// 查看端口命令： netstat -antulp
// 停止防火墙命令：systemctl stop firewalld
//云服务腾讯
//git clone https://github.com/BrowserBox/BrowserBoxPro.git && cd BrowserBoxPro && sudo apt update && sudo apt install -y nodejs npm && npm install && npm start
//宝塔 https://82.156.162.242:22947/d9450c6f    hazwa0sx   e6d8902e
/**系统重装时候采用删除持久化文件的方式 */
export default createStore<state_t>()(immer(cwdPersist({
    cwd: path.dirname(path.dirname(__filename)),
    initializer: (set, get) => ({
        sshConfig: {
            host: "82.156.162.242",
            port: 54321,
            username: 'root',
            password: '9K78s98[98]j.9',
        },
        peerServer_port: 9000,
        coturn_default_port: 3478,
        coturn_tls_port: 5349,
        coturn_relay_port_start: 49152,
    }),
})))
