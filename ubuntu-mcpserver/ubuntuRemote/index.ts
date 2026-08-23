import mcpserver from "mcpserver";
import store from "../store";
import { z } from "zod";
import {
  nginxProxyRouteValidator,
  nginxRouteValidator,
  nginxStaticRouteValidator,
  nodeDeploymentPackageValidator,
  nodeDependenciesInstallValidator,
  pm2IdValidator,
  pm2NameValidator,
  pm2ProcessValidator,
  sftpDownloadValidator,
  sftpFileValidator,
  sftpTextReadValidator,
  sftpTextUploadValidator,
  sshExecuteValidator,
} from "./store";

const emptyValidator = z.object({}).strict();
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const mutate = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export default mcpserver.RegisterSlice({ sliceName: "ubuntuRemote" })
  .tool.register("post", "/config/public", emptyValidator, "Read public domain and remote root from ubuntu-lib store.", read, context => context.json(store.getState().ubuntuRemoteActions.publicConfig()))
  .tool.register("post", "/config/ssh", emptyValidator, "Read SSH host configuration without returning the password.", read, context => context.json(store.getState().ubuntuRemoteActions.sshConfig()))
  .tool.register("post", "/config/peerjs", emptyValidator, "Read PeerJS configuration from ubuntu-lib store.", read, context => context.json(store.getState().ubuntuRemoteActions.peerjsConfig()))
  .tool.register("post", "/config/stunServer", emptyValidator, "Read STUN configuration from ubuntu-lib store.", read, context => context.json(store.getState().ubuntuRemoteActions.stunServerConfig()))
  .tool.register("post", "/config/webrtcsignaling", emptyValidator, "Read WebRTC signaling configuration from ubuntu-lib store.", read, context => context.json(store.getState().ubuntuRemoteActions.webrtcsignalingConfig()))
  .tool.register("post", "/ssh/state", emptyValidator, "Read SSH connection state without returning the password.", read, context => context.json(store.getState().ubuntuRemoteActions.sshState()))
  .tool.register("post", "/ssh/connect", emptyValidator, "Connect and verify SSH through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.sshConnect()))
  .tool.register("post", "/ssh/execute", sshExecuteValidator, "Execute a remote command through ubuntu-lib SSH.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.sshExecute(context.req.valid("json"))))
  .tool.register("post", "/ssh/dispose", emptyValidator, "Dispose the ubuntu-lib SSH connection.", mutate, context => context.json(store.getState().ubuntuRemoteActions.sshDispose()))
  .tool.register("post", "/apt/ensure", emptyValidator, "Ensure remote Apt prerequisites through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.aptEnsure()))
  .tool.register("post", "/docker/ensure", emptyValidator, "Ensure remote Docker through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.dockerEnsure()))
  .tool.register("post", "/node/ensure", emptyValidator, "Ensure remote Node.js through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.nodeEnsure()))
  .tool.register("post", "/node/deploymentPackage", nodeDeploymentPackageValidator, "Create a production deployment package manifest through ubuntu-lib.", read, async context => context.json(await store.getState().ubuntuRemoteActions.nodeDeploymentPackage(context.req.valid("json"))))
  .tool.register("post", "/node/dependenciesInstall", nodeDependenciesInstallValidator, "Install remote Node production dependencies through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.nodeDependenciesInstall(context.req.valid("json"))))
  .tool.register("post", "/pm2/state", emptyValidator, "Read the cached PM2 state from ubuntu-lib.", read, context => context.json(store.getState().ubuntuRemoteActions.pm2State()))
  .tool.register("post", "/pm2/refresh", emptyValidator, "Refresh remote PM2 state through ubuntu-lib.", read, async context => context.json(await store.getState().ubuntuRemoteActions.pm2Refresh()))
  .tool.register("post", "/pm2/stop", pm2IdValidator, "Stop a remote PM2 process through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.pm2Stop(context.req.valid("json"))))
  .tool.register("post", "/pm2/restart", pm2IdValidator, "Restart a remote PM2 process through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.pm2Restart(context.req.valid("json"))))
  .tool.register("post", "/pm2/processStart", pm2ProcessValidator, "Start a named PM2 process and verify its port through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.pm2ProcessStart(context.req.valid("json"))))
  .tool.register("post", "/pm2/processStop", pm2NameValidator, "Stop a named PM2 process through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.pm2ProcessStop(context.req.valid("json"))))
  .tool.register("post", "/sftp/upload", sftpFileValidator, "Upload a local file through ubuntu-lib SFTP.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.sftpUpload(context.req.valid("json"))))
  .tool.register("post", "/sftp/textUpload", sftpTextUploadValidator, "Upload remote text through ubuntu-lib SFTP.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.sftpTextUpload(context.req.valid("json"))))
  .tool.register("post", "/sftp/textRead", sftpTextReadValidator, "Read remote text through ubuntu-lib SFTP.", read, async context => context.json(await store.getState().ubuntuRemoteActions.sftpTextRead(context.req.valid("json"))))
  .tool.register("post", "/sftp/download", sftpDownloadValidator, "Download a remote file through ubuntu-lib SFTP.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.sftpDownload(context.req.valid("json"))))
  .tool.register("post", "/nginx/state", emptyValidator, "Read the public Nginx state from ubuntu-lib.", read, context => context.json(store.getState().ubuntuRemoteActions.nginxState()))
  .tool.register("post", "/nginx/ensure", emptyValidator, "Ensure remote Nginx through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.nginxEnsure()))
  .tool.register("post", "/nginx/proxyRoute", nginxProxyRouteValidator, "Write an Nginx proxy route through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.nginxProxyRoute(context.req.valid("json"))))
  .tool.register("post", "/nginx/staticRoute", nginxStaticRouteValidator, "Write an Nginx static route through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.nginxStaticRoute(context.req.valid("json"))))
  .tool.register("post", "/nginx/routeClose", nginxRouteValidator, "Close an Nginx route through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.nginxRouteClose(context.req.valid("json"))))
  .tool.register("post", "/peerjs/state", emptyValidator, "Read PeerJS state from ubuntu-lib.", read, context => context.json(store.getState().ubuntuRemoteActions.peerjsState()))
  .tool.register("post", "/peerjs/ensure", emptyValidator, "Ensure remote PeerJS through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.peerjsEnsure()))
  .tool.register("post", "/stunServer/state", emptyValidator, "Read STUN state from ubuntu-lib.", read, context => context.json(store.getState().ubuntuRemoteActions.stunServerState()))
  .tool.register("post", "/stunServer/ensure", emptyValidator, "Ensure remote STUN through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.stunServerEnsure()))
  .tool.register("post", "/webrtcsignaling/state", emptyValidator, "Read WebRTC signaling state from ubuntu-lib.", read, context => context.json(store.getState().ubuntuRemoteActions.webrtcsignalingState()))
  .tool.register("post", "/webrtcsignaling/ensure", emptyValidator, "Ensure remote WebRTC signaling through ubuntu-lib.", mutate, async context => context.json(await store.getState().ubuntuRemoteActions.webrtcsignalingEnsure()));
