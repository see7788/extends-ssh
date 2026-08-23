import { isAbsolute } from "node:path";
import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import ubuntu from "ubuntu-lib/index.ts";
import { z } from "zod";

const pathValidator = z.string().trim().min(1).refine(isAbsolute, "path must be absolute");
const remotePathValidator = z.string().trim().min(1);
export const sshExecuteValidator = z.object({ command: z.string().trim().min(1) }).strict();
export const nodeDeploymentPackageValidator = z.object({ buildPath: pathValidator, projectPath: pathValidator }).strict();
export const nodeDependenciesInstallValidator = z.object({ projectPath: remotePathValidator }).strict();
export const pm2IdValidator = z.object({ id: z.number().int().nonnegative() }).strict();
export const pm2ProcessValidator = z.object({
  name: z.string().trim().min(1),
  path: remotePathValidator,
  command: z.string().trim().min(1),
  port: z.number().int().min(1).max(65_535),
  environment: z.record(z.string(), z.string()).optional(),
}).strict();
export const pm2NameValidator = z.object({ name: z.string().trim().min(1) }).strict();
export const sftpFileValidator = z.object({ localPath: pathValidator, remotePath: remotePathValidator }).strict();
export const sftpTextUploadValidator = z.object({ text: z.string(), remotePath: remotePathValidator }).strict();
export const sftpTextReadValidator = z.object({ remotePath: remotePathValidator }).strict();
export const sftpDownloadValidator = z.object({ remotePath: remotePathValidator, localPath: pathValidator }).strict();
const pathnameValidator = z.string().regex(/^\//);
export const nginxProxyRouteValidator = z.object({ name: z.string().trim().min(1), hostname: z.string().trim().min(1), pathname: pathnameValidator, upstreamPort: z.number().int().min(1).max(65_535) }).strict();
export const nginxStaticRouteValidator = z.object({ name: z.string().trim().min(1), hostname: z.string().trim().min(1), pathname: pathnameValidator, root: z.string().regex(/^\//), spaFallback: z.boolean() }).strict();
export const nginxRouteValidator = z.object({ name: z.string().trim().min(1), hostname: z.string().trim().min(1) }).strict();

type UbuntuRemoteSlice = {
  ubuntuRemoteActions: {
    publicConfig(): { domain: string; remoteRoot: string };
    sshConfig(): { host: string; port: number; username: string };
    peerjsConfig(): typeof ubuntu.peerjs.state;
    stunServerConfig(): typeof ubuntu.stunServer.state;
    webrtcsignalingConfig(): typeof ubuntu.webrtcsignaling.state;
    sshState(): { host: string; port: number; username: string; revision: number };
    sshConnect(): Promise<{ host: string; port: number; username: string; revision: number }>;
    sshExecute(input: z.output<typeof sshExecuteValidator>): ReturnType<typeof ubuntu.ssh.execute>;
    sshDispose(): { disposed: true };
    aptEnsure(): Promise<{ ready: true }>;
    dockerEnsure(): Promise<{ ready: true }>;
    nodeEnsure(): Promise<{ ready: true }>;
    nodeDeploymentPackage(input: z.output<typeof nodeDeploymentPackageValidator>): ReturnType<typeof ubuntu.nodejs.deploymentPackageCreate>;
    nodeDependenciesInstall(input: z.output<typeof nodeDependenciesInstallValidator>): Promise<{ installed: true }>;
    pm2State(): typeof ubuntu.pm2.state;
    pm2Refresh(): ReturnType<typeof ubuntu.pm2.refresh>;
    pm2Stop(input: z.output<typeof pm2IdValidator>): ReturnType<typeof ubuntu.pm2.stop>;
    pm2Restart(input: z.output<typeof pm2IdValidator>): ReturnType<typeof ubuntu.pm2.restart>;
    pm2ProcessStart(input: z.output<typeof pm2ProcessValidator>): Promise<{ started: true }>;
    pm2ProcessStop(input: z.output<typeof pm2NameValidator>): Promise<{ stopped: true }>;
    sftpUpload(input: z.output<typeof sftpFileValidator>): Promise<{ uploaded: true }>;
    sftpTextUpload(input: z.output<typeof sftpTextUploadValidator>): Promise<{ uploaded: true }>;
    sftpTextRead(input: z.output<typeof sftpTextReadValidator>): ReturnType<typeof ubuntu.sftp.remoteTextRead>;
    sftpDownload(input: z.output<typeof sftpDownloadValidator>): Promise<{ downloaded: true }>;
    nginxState(): typeof ubuntu.nginx.state;
    nginxEnsure(): Promise<{ ready: true }>;
    nginxProxyRoute(input: z.output<typeof nginxProxyRouteValidator>): Promise<{ configured: true }>;
    nginxStaticRoute(input: z.output<typeof nginxStaticRouteValidator>): Promise<{ configured: true }>;
    nginxRouteClose(input: z.output<typeof nginxRouteValidator>): Promise<{ closed: true }>;
    peerjsState(): typeof ubuntu.peerjs.state;
    peerjsEnsure(): Promise<{ ready: true }>;
    stunServerState(): typeof ubuntu.stunServer.state;
    stunServerEnsure(): Promise<{ ready: true }>;
    webrtcsignalingState(): typeof ubuntu.webrtcsignaling.state;
    webrtcsignalingEnsure(): Promise<{ ready: true }>;
  };
};

const s: ImmerStateCreator<UbuntuRemoteSlice> = () => ({
  ubuntuRemoteActions: {
    publicConfig() { return ubuntu.public; },
    sshConfig() { const { host, port, username } = ubuntu.ssh.state; return { host, port, username }; },
    peerjsConfig() { return ubuntu.peerjs.state; },
    stunServerConfig() { return ubuntu.stunServer.state; },
    webrtcsignalingConfig() { return ubuntu.webrtcsignaling.state; },
    sshState() { const { host, port, username } = ubuntu.ssh.state; return { host, port, username, revision: ubuntu.ssh.revision }; },
    async sshConnect() { await ubuntu.ssh.isRunning(); const { host, port, username } = ubuntu.ssh.state; return { host, port, username, revision: ubuntu.ssh.revision }; },
    sshExecute(input) { return ubuntu.ssh.execute(input.command); },
    sshDispose() { ubuntu.ssh.dispose(); return { disposed: true }; },
    async aptEnsure() { await ubuntu.apt.isRemoteRunning(); return { ready: true }; },
    async dockerEnsure() { await ubuntu.docker.isRemoteRunning(); return { ready: true }; },
    async nodeEnsure() { await ubuntu.nodejs.isRemoteRunning(); return { ready: true }; },
    nodeDeploymentPackage(input) { return ubuntu.nodejs.deploymentPackageCreate(input.buildPath, input.projectPath); },
    async nodeDependenciesInstall(input) { await ubuntu.nodejs.dependenciesRemoteInstall(input.projectPath); return { installed: true }; },
    pm2State() { return ubuntu.pm2.state; },
    pm2Refresh() { return ubuntu.pm2.refresh(); },
    pm2Stop(input) { return ubuntu.pm2.stop(input.id); },
    pm2Restart(input) { return ubuntu.pm2.restart(input.id); },
    async pm2ProcessStart(input) { await ubuntu.pm2.processIsRemoteRunning(input); return { started: true }; },
    async pm2ProcessStop(input) { await ubuntu.pm2.processRemoteClose(input.name); return { stopped: true }; },
    async sftpUpload(input) { await ubuntu.sftp.remoteUpload(input.localPath, input.remotePath); return { uploaded: true }; },
    async sftpTextUpload(input) { await ubuntu.sftp.remoteTextUpload(input.text, input.remotePath); return { uploaded: true }; },
    sftpTextRead(input) { return ubuntu.sftp.remoteTextRead(input.remotePath); },
    async sftpDownload(input) { await ubuntu.sftp.locDownload(input.remotePath, input.localPath); return { downloaded: true }; },
    nginxState() { return ubuntu.nginx.state; },
    async nginxEnsure() { await ubuntu.nginx.isRemoteRunning(); return { ready: true }; },
    async nginxProxyRoute(input) { await ubuntu.nginx.proxyRouteIsRunning({ ...input, pathname: input.pathname as `/${string}` }); return { configured: true }; },
    async nginxStaticRoute(input) { await ubuntu.nginx.staticRouteIsRunning({ ...input, pathname: input.pathname as `/${string}` }); return { configured: true }; },
    async nginxRouteClose(input) { await ubuntu.nginx.routeClose(input); return { closed: true }; },
    peerjsState() { return ubuntu.peerjs.state; },
    async peerjsEnsure() { await ubuntu.peerjs.isRemoteRunning(); return { ready: true }; },
    stunServerState() { return ubuntu.stunServer.state; },
    async stunServerEnsure() { await ubuntu.stunServer.isRemoteRunning(); return { ready: true }; },
    webrtcsignalingState() { return ubuntu.webrtcsignaling.state; },
    async webrtcsignalingEnsure() { await ubuntu.webrtcsignaling.isRemoteRunning(); return { ready: true }; },
  },
});

export default s;
