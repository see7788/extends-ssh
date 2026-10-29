import store from "../store.ts";

export type VitePersistedState = Record<string, unknown> & {
  readonly packagePath: string;
};

export function listViteState(): Array<VitePersistedState & { readonly devPort: number }> {
  return Object.entries(store.getState().vite).map(([devPort, value]) => ({
    devPort: Number(devPort),
    ...value,
  }));
}

export function getViteState(devPort: number): (VitePersistedState & { readonly devPort: number }) | undefined {
  const value = store.getState().vite[devPort];
  return value ? { devPort, ...value } : undefined;
}
