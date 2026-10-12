import Base from "./Base.ts";
class Index {
  /**webrtc信令 */
  get producer9002() {
    return new Base<{devPort:9002}>({devPort:9002}).pm2Add({ command: "pnpm dev" })
  }
  get peerjs(){
    return new Base({devPort:3005})
  }
}
export default new Index
