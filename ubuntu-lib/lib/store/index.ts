import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import publicStore from "../Public/store.ts";
import peerjsStore from "../Peerjs/store.ts";
import sftpStore from "../Sftp/store.ts";
import sshStore from "../Ssh/store.ts";
import stunServerStore from "../StunServer/store.ts";
import type { Store } from "./type.ts";

const statePath = path.join(homedir(), ".extends-ssh", ".zustand", "ubuntu-lib.json");
const storage: StateStorage = {
  getItem: () => {
    try { return readFileSync(statePath, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  },
  setItem: (_name, value) => { mkdirSync(path.dirname(statePath), { recursive: true }); writeFileSync(statePath, value, "utf8"); },
  removeItem: () => { try { rmSync(statePath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } },
};
const jsonStorage = createJSONStorage<Partial<Store>>(() => storage);

const portLocks = new Map<number, Promise<void>>();
export function withPortLock<T>(port: number, action: () => Promise<T>): Promise<T> {
  const previous = portLocks.get(port) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  portLocks.set(port, current);
  return previous.catch(() => undefined).then(action).finally(() => {
    release();
    if (portLocks.get(port) === current) portLocks.delete(port);
  });
}

const store = createStore<Store>()(persist(immer<Store>((...s) => ({
  ...publicStore(...s),
  ...peerjsStore(...s),
  ...sftpStore(...s),
  ...sshStore(...s),
  ...stunServerStore(...s),
})), {
  name: "ubuntu-lib",
  storage: jsonStorage,
  version: 2,
  migrate: persistedState => {
    const state = persistedState as Partial<Store> & { pm2?: unknown; sshForward?: unknown };
    delete state.pm2;
    delete state.sshForward;
    return state;
  },
}));

export default store;

