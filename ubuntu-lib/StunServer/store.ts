import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const stunServerStore: ImmerStateCreator<{
  stunServer: {
    port: number; // STUN 服务监听端口
    containerName: string; // Docker 容器名称
    image: string; // coturn Docker 镜像
    restartPolicy: "no" | "always" | "unless-stopped" | "on-failure" | `on-failure:${number}`; // Docker 容器重启策略
    mode: string; // coturn 运行模式
  };
}> = () => ({
  stunServer: {
    port: 3478,
    containerName: "coturn",
    image: "coturn/coturn:latest",
    restartPolicy: "unless-stopped",
    mode: "stun-only",
  },
});

export default stunServerStore;
