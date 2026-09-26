import Base from "./Base.ts";

export function webRtcSignaling() {
  const port = 9002;
  const path = "/signal";
  const base = new Base(port).addPm2({ command: "pnpm dev" }).addSftp();
  return base.start({
    server: { path },
    client: { path },
  });
}
