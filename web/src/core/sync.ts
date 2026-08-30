import type { CompletionRecord, ProfileRecord, RoomRecord, TaskRecord } from "./types";

export const SYNC_PROTOCOL_VERSION = 1 as const;
export type SyncEntityType = "home" | "profile" | "room" | "task" | "completion";
export type SyncPayload =
  | { name: string }
  | Omit<ProfileRecord, "id">
  | Omit<RoomRecord, "id">
  | Omit<TaskRecord, "id">
  | Omit<CompletionRecord, "id">;

export interface PendingSyncMutation {
  id: string;
  entityKey: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: "upsert" | "delete";
  baseRevision: string;
  payload?: SyncPayload;
  createdAt: string;
}

export interface SyncRevision {
  id: string;
  revision: string;
}

export interface SyncConnection {
  id: "connection";
  serverUrl: string;
  serverName: string;
  token: string;
  homeId: string;
  deviceId: string;
  cursor: string;
  lastSyncedAt?: string;
}

export interface SyncConflict {
  id: string;
  mutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  reason: string;
  serverRevision: string;
  serverPayload?: SyncPayload;
}

export interface SyncSnapshotRecord<T extends SyncPayload> {
  id: string;
  revision: string;
  payload: T;
}

export interface ServerSnapshot {
  protocolVersion: 1;
  cursor: string;
  home: SyncSnapshotRecord<{ name: string }>;
  profiles: Array<SyncSnapshotRecord<Omit<ProfileRecord, "id">>>;
  rooms: Array<SyncSnapshotRecord<Omit<RoomRecord, "id">>>;
  tasks: Array<SyncSnapshotRecord<Omit<TaskRecord, "id">>>;
  completions: Array<SyncSnapshotRecord<Omit<CompletionRecord, "id">>>;
}

export interface SyncChange {
  cursor: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: "upsert" | "delete";
  revision: string;
  payload?: SyncPayload;
}

export interface SyncResponse {
  protocolVersion: 1;
  cursor: string;
  hasMore: boolean;
  acknowledgements: Array<{ mutationId: string; entityType: SyncEntityType; entityId: string; revision: string }>;
  conflicts: Array<{ mutationId: string; entityType: SyncEntityType; entityId: string; reason: string; serverRevision: string; serverPayload?: SyncPayload }>;
  changes: SyncChange[];
}

export const entityKey = (type: SyncEntityType, id: string): string => `${type}:${id}`;
