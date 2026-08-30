import type { ServerSnapshot, SyncConnection, SyncResponse } from "../core/sync";
import { SYNC_PROTOCOL_VERSION } from "../core/sync";
import { applySyncResponse, connectToSnapshot, disconnectSync, pendingMutations, snapshot, syncState } from "../data/db";

export type SyncPhase = "local" | "connecting" | "syncing" | "synced" | "pending" | "attention" | "offline" | "error";
export interface RuntimeSyncStatus { phase: SyncPhase; message: string; }
export interface PairSession {
  connection: SyncConnection;
  snapshot: ServerSnapshot;
}

let runtimeStatus: RuntimeSyncStatus = { phase: "local", message: "Saved in this browser" };
let activeSync: Promise<void> | undefined;
let retryTimer: number | undefined;
const listeners = new Set<(status: RuntimeSyncStatus) => void>();

function publish(status: RuntimeSyncStatus): void {
  runtimeStatus = status;
  for (const listener of listeners) listener(status);
}

export const currentSyncStatus = (): RuntimeSyncStatus => runtimeStatus;
export function observeSyncStatus(listener: (status: RuntimeSyncStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function api(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/+$/, "")}/api/sync/v1${path}`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
  if (!response.ok) throw new Error(body?.error?.message ?? `The sync server returned ${response.status}.`);
  return body as T;
}

export async function enrollWithServer(homeName: string, deviceName: string, serverUrl = location.origin): Promise<PairSession> {
  publish({ phase: "connecting", message: "Setting up server" });
  const normalizedUrl = new URL(serverUrl, location.origin);
  if (normalizedUrl.protocol !== "https:" && normalizedUrl.hostname !== "localhost" && normalizedUrl.hostname !== "127.0.0.1") {
    throw new Error("The sync server must use HTTPS.");
  }
  const origin = normalizedUrl.origin;
  const discovery = await responseJson<{ name: string; protocolVersions: number[] }>(await fetch(api(origin, "/discovery"), { cache: "no-store" }));
  if (!discovery.protocolVersions.includes(SYNC_PROTOCOL_VERSION)) throw new Error("This server does not support the browser's sync protocol.");
  const setup = await responseJson<{
    protocolVersion: 1;
    deviceToken: string;
    deviceId: string;
    homeId: string;
    snapshot: ServerSnapshot;
  }>(await fetch(api(origin, "/enroll"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ homeName, deviceName })
  }));
  return {
    connection: {
      id: "connection",
      serverUrl: origin,
      serverName: discovery.name,
      token: setup.deviceToken,
      homeId: setup.homeId,
      deviceId: setup.deviceId,
      cursor: setup.snapshot.cursor
    },
    snapshot: setup.snapshot
  };
}

export async function finishPairing(session: PairSession, mode: "use-local" | "use-server"): Promise<void> {
  await connectToSnapshot(session.connection, session.snapshot, mode);
  await snapshot();
  await syncNow();
}

export async function cancelPairing(session: PairSession): Promise<void> {
  await fetch(api(session.connection.serverUrl, "/devices/current"), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.connection.token}` }
  }).catch(() => undefined);
  publish({ phase: "local", message: "Saved in this browser" });
}

export async function syncNow(): Promise<void> {
  if (activeSync) return activeSync;
  activeSync = performSync().finally(() => { activeSync = undefined; });
  return activeSync;
}

async function performSync(): Promise<void> {
  const initial = await syncState();
  if (!initial.connection) {
    publish({ phase: "local", message: "Saved in this browser" });
    return;
  }
  if (!navigator.onLine) {
    publish({ phase: "offline", message: initial.pending ? `${initial.pending} changes waiting for server` : "Offline copy is available" });
    return;
  }
  publish({ phase: "syncing", message: "Saving to PostgreSQL" });
  try {
    let hasMore = true;
    let passes = 0;
    while (hasMore && passes < 50) {
      const state = await syncState();
      if (!state.connection) return;
      const mutations = await pendingMutations();
      const response = await responseJson<SyncResponse>(await fetch(api(state.connection.serverUrl, "/sync"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.connection.token}` },
        body: JSON.stringify({
          protocolVersion: SYNC_PROTOCOL_VERSION,
          cursor: state.connection.cursor,
          mutations: mutations.map(({ entityKey: _, createdAt: __, ...mutation }) => mutation)
        })
      }));
      await applySyncResponse(response);
      hasMore = response.hasMore || (mutations.length === 500 && !response.conflicts.length);
      passes += 1;
      if (response.conflicts.length) break;
    }
    const state = await syncState();
    if (state.conflicts.length) publish({ phase: "attention", message: `${state.conflicts.length} sync conflict${state.conflicts.length === 1 ? "" : "s"}` });
    else if (state.pending) publish({ phase: "pending", message: `${state.pending} changes waiting for server` });
    else publish({ phase: "synced", message: `Saved to PostgreSQL on ${state.connection?.serverName ?? "server"}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach the sync server.";
    publish({ phase: navigator.onLine ? "error" : "offline", message });
    throw error;
  }
}

export function scheduleSync(delay = 500): void {
  if (retryTimer != null) window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => void syncNow().catch(() => undefined), delay);
}

export async function disconnectFromServer(): Promise<void> {
  const state = await syncState();
  if (state.connection) {
    await fetch(api(state.connection.serverUrl, "/devices/current"), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${state.connection.token}` }
    }).catch(() => undefined);
  }
  await disconnectSync();
  publish({ phase: "local", message: "Saved in this browser" });
}

export async function startSyncService(): Promise<void> {
  const state = await syncState();
  if (!state.connection) publish({ phase: "local", message: "Saved in this browser" });
  else if (state.conflicts.length) publish({ phase: "attention", message: `${state.conflicts.length} sync conflicts` });
  else publish({ phase: state.pending ? "pending" : "synced", message: state.pending ? `${state.pending} changes waiting for server` : `Saved to PostgreSQL on ${state.connection.serverName}` });
  window.addEventListener("online", () => void syncNow().catch(() => undefined));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncNow().catch(() => undefined); });
  await syncNow().catch(() => undefined);
}

export async function hasLocalPlan(): Promise<boolean> {
  const local = await snapshot();
  return local.rooms.length > 0 || local.tasks.length > 0 || local.completions.length > 0;
}
