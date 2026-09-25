import Base from "./Base.ts";
import store from "../store/index.ts";
export function webRtcSignaling() {
    return new Base(9002).addPm2({ command: "pnpm dev" }).addSftp().start({
        define: {
            host: `webrtc.${store.getState().domain}`,
            port: 443,
            path: "/signal",
            secure: true,
        }
    })
}
