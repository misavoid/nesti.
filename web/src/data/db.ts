import { dateKey, nextDueDate } from "../core/dates";
import { normalizeImportedDueDate } from "../core/codec";
import type { AppSnapshot, CompletionRecord, NestiDocument, ProfileRecord, RoomRecord, SettingsRecord, TaskRecord } from "../core/types";
import { entityKey, mutationApplicationPriority, type PendingSyncMutation, type ServerSnapshot, type SyncChange, type SyncConflict, type SyncConnection, type SyncEntityType, type SyncPayload, type SyncResponse, type SyncRevision } from "../core/sync";

const DB_NAME = "nesti";
const DB_VERSION = 2;
const dataStores = ["rooms", "tasks", "completions", "profiles", "settings"] as const;
const syncStores = ["sync", "outbox", "revisions", "conflicts"] as const;
const allStores = [...dataStores, ...syncStores] as const;

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Storage transaction aborted."));
  });
}

async function database(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains("rooms")) db.createObjectStore("rooms", { keyPath: "id" });
    if (!db.objectStoreNames.contains("tasks")) {
      const tasks = db.createObjectStore("tasks", { keyPath: "id" });
      tasks.createIndex("roomId", "roomId");
    }
    if (!db.objectStoreNames.contains("completions")) {
      const completions = db.createObjectStore("completions", { keyPath: "id" });
      completions.createIndex("taskId", "taskId");
      completions.createIndex("profileId", "profileId");
    } else if (!open.transaction!.objectStore("completions").indexNames.contains("profileId")) {
      open.transaction!.objectStore("completions").createIndex("profileId", "profileId");
    }
    if (!db.objectStoreNames.contains("profiles")) db.createObjectStore("profiles", { keyPath: "id" });
    if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
    if (!db.objectStoreNames.contains("sync")) db.createObjectStore("sync", { keyPath: "id" });
    if (!db.objectStoreNames.contains("outbox")) {
      const outbox = db.createObjectStore("outbox", { keyPath: "id" });
      outbox.createIndex("entityKey", "entityKey", { unique: true });
      outbox.createIndex("createdAt", "createdAt");
    }
    if (!db.objectStoreNames.contains("revisions")) db.createObjectStore("revisions", { keyPath: "id" });
    if (!db.objectStoreNames.contains("conflicts")) db.createObjectStore("conflicts", { keyPath: "id" });
  };
  return request(open);
}

async function ensureDefaultProfile(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([...dataStores, ...syncStores], "readwrite");
  const done = transactionDone(tx);
  const profiles = tx.objectStore("profiles");
  if (await request(profiles.count()) > 0) return done;
  const profile: ProfileRecord = { id: crypto.randomUUID(), name: "Me", color: "#147d64", sortOrder: 0 };
  profiles.put(profile);
  const settingsStore = tx.objectStore("settings");
  const settings = await request(settingsStore.get("settings")) as SettingsRecord | undefined;
  settingsStore.put({ ...(settings ?? { id: "settings", homeName: "My Home" }), activeProfileId: profile.id });
  await enqueueMutation(tx, "profile", profile.id, "upsert", withoutId(profile));
  await done;
}

export async function snapshot(): Promise<AppSnapshot> {
  const db = await database();
  await ensureDefaultProfile(db);
  const transaction = db.transaction(dataStores, "readonly");
  const [rooms, tasks, completions, profiles, settings] = await Promise.all([
    request(transaction.objectStore("rooms").getAll()) as Promise<RoomRecord[]>,
    request(transaction.objectStore("tasks").getAll()) as Promise<TaskRecord[]>,
    request(transaction.objectStore("completions").getAll()) as Promise<CompletionRecord[]>,
    request(transaction.objectStore("profiles").getAll()) as Promise<ProfileRecord[]>,
    request(transaction.objectStore("settings").get("settings")) as Promise<SettingsRecord | undefined>
  ]);
  const orderedProfiles = profiles.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const normalizedSettings = settings ?? { id: "settings", homeName: "My Home", activeProfileId: orderedProfiles[0]?.id };
  if (!normalizedSettings.activeProfileId || !orderedProfiles.some((profile) => profile.id === normalizedSettings.activeProfileId)) {
    normalizedSettings.activeProfileId = orderedProfiles[0]?.id;
  }
  return {
    rooms: rooms.sort((a, b) => a.sortOrder - b.sortOrder),
    tasks: tasks.sort((a, b) => a.sortOrder - b.sortOrder),
    completions: completions.sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    profiles: orderedProfiles,
    settings: normalizedSettings
  };
}

function withoutId<T extends { id: string }>(value: T): Omit<T, "id"> {
  const { id: _, ...payload } = value;
  return payload;
}

async function enqueueMutation(
  tx: IDBTransaction,
  entityType: SyncEntityType,
  entityId: string,
  operation: "upsert" | "delete",
  payload?: SyncPayload
): Promise<void> {
  const connection = await request(tx.objectStore("sync").get("connection")) as SyncConnection | undefined;
  if (!connection) return;
  const key = entityKey(entityType, entityId);
  const outbox = tx.objectStore("outbox");
  const existing = await request(outbox.index("entityKey").get(key)) as PendingSyncMutation | undefined;
  const revision = await request(tx.objectStore("revisions").get(key)) as SyncRevision | undefined;
  if (operation === "delete" && existing?.baseRevision === "0") {
    outbox.delete(existing.id);
    tx.objectStore("conflicts").delete(key);
    return;
  }
  if (existing) outbox.delete(existing.id);
  const mutation: PendingSyncMutation = {
    id: crypto.randomUUID(),
    entityKey: key,
    entityType,
    entityId,
    operation,
    baseRevision: existing?.baseRevision ?? revision?.revision ?? "0",
    createdAt: existing?.createdAt ?? new Date().toISOString()
  };
  if (payload != null) mutation.payload = payload;
  outbox.put(mutation);
  tx.objectStore("conflicts").delete(key);
}

export async function saveRoom(room: RoomRecord): Promise<void> {
  const db = await database();
  const tx = db.transaction(["rooms", ...syncStores], "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("rooms").put(room);
  await enqueueMutation(tx, "room", room.id, "upsert", withoutId(room));
  await done;
}

export async function saveTask(task: TaskRecord): Promise<void> {
  const db = await database();
  const tx = db.transaction(["tasks", ...syncStores], "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("tasks").put(task);
  await enqueueMutation(tx, "task", task.id, "upsert", withoutId(task));
  await done;
}

export async function saveSettings(settings: SettingsRecord): Promise<void> {
  const db = await database();
  const tx = db.transaction(["settings", ...syncStores], "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("settings").put(settings);
  const connection = await request(tx.objectStore("sync").get("connection")) as SyncConnection | undefined;
  if (connection) await enqueueMutation(tx, "home", connection.homeId, "upsert", { name: settings.homeName });
  await done;
}

export async function saveProfile(profile: ProfileRecord): Promise<void> {
  const db = await database();
  const tx = db.transaction(["profiles", "settings", ...syncStores], "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("profiles").put(profile);
  const settings = await request(tx.objectStore("settings").get("settings")) as SettingsRecord | undefined;
  if (!settings?.activeProfileId) tx.objectStore("settings").put({ ...(settings ?? { id: "settings", homeName: "My Home" }), activeProfileId: profile.id });
  await enqueueMutation(tx, "profile", profile.id, "upsert", withoutId(profile));
  await done;
}

export async function selectProfile(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction("settings", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("settings");
  const settings = await request(store.get("settings")) as SettingsRecord | undefined;
  store.put({ ...(settings ?? { id: "settings", homeName: "My Home" }), activeProfileId: id });
  await done;
}

export async function deleteProfile(id: string): Promise<void> {
  const current = await snapshot();
  if (current.profiles.length <= 1) throw new Error("A home needs at least one profile.");
  const db = await database();
  const tx = db.transaction(["profiles", "settings", ...syncStores], "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("profiles").delete(id);
  if (current.settings.activeProfileId === id) {
    tx.objectStore("settings").put({ ...current.settings, activeProfileId: current.profiles.find((profile) => profile.id !== id)?.id });
  }
  await enqueueMutation(tx, "profile", id, "delete");
  await done;
}

export async function deleteTask(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(["tasks", "completions", ...syncStores], "readwrite");
  const done = transactionDone(tx);
  const completionStore = tx.objectStore("completions");
  const completions = await request(completionStore.index("taskId").getAll(IDBKeyRange.only(id))) as CompletionRecord[];
  for (const completion of completions) {
    completionStore.delete(completion.id);
    await enqueueMutation(tx, "completion", completion.id, "delete");
  }
  tx.objectStore("tasks").delete(id);
  await enqueueMutation(tx, "task", id, "delete");
  await done;
}

export async function deleteRoom(id: string): Promise<void> {
  const current = await snapshot();
  const tasks = current.tasks.filter((task) => task.roomId === id);
  const taskIds = new Set(tasks.map((task) => task.id));
  const db = await database();
  const tx = db.transaction(["rooms", "tasks", "completions", ...syncStores], "readwrite");
  const done = transactionDone(tx);
  for (const completion of current.completions.filter((item) => taskIds.has(item.taskId))) {
    tx.objectStore("completions").delete(completion.id);
    await enqueueMutation(tx, "completion", completion.id, "delete");
  }
  for (const task of tasks) {
    tx.objectStore("tasks").delete(task.id);
    await enqueueMutation(tx, "task", task.id, "delete");
  }
  tx.objectStore("rooms").delete(id);
  await enqueueMutation(tx, "room", id, "delete");
  await done;
}

export async function completeTask(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(["tasks", "completions", "settings", ...syncStores], "readwrite");
  const done = transactionDone(tx);
  const taskStore = tx.objectStore("tasks");
  const task = await request(taskStore.get(id)) as TaskRecord | undefined;
  if (!task) throw new Error("Task not found.");
  const settings = await request(tx.objectStore("settings").get("settings")) as SettingsRecord | undefined;
  const now = new Date();
  const completion: CompletionRecord = {
    id: crypto.randomUUID(),
    taskId: id,
    completedAt: now.toISOString()
  };
  if (settings?.activeProfileId) completion.profileId = settings.activeProfileId;
  if (task.nextDueDate) completion.scheduledFor = task.nextDueDate;
  task.lastCompletedAt = completion.completedAt;
  task.nextDueDate = task.schedule ? nextDueDate(task.schedule, dateKey(now), completion.scheduledFor) : undefined;
  taskStore.put(task);
  tx.objectStore("completions").put(completion);
  await enqueueMutation(tx, "task", task.id, "upsert", withoutId(task));
  await enqueueMutation(tx, "completion", completion.id, "upsert", withoutId(completion));
  await done;
}

export async function undoCompletion(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(["tasks", "completions", ...syncStores], "readwrite");
  const done = transactionDone(tx);
  const completionStore = tx.objectStore("completions");
  const completion = await request(completionStore.get(id)) as CompletionRecord | undefined;
  if (!completion) return;
  const taskStore = tx.objectStore("tasks");
  const task = await request(taskStore.get(completion.taskId)) as TaskRecord | undefined;
  if (task) {
    const remaining = (await request(completionStore.index("taskId").getAll(IDBKeyRange.only(task.id))) as CompletionRecord[]).filter((item) => item.id !== id);
    const latest = remaining.sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    task.lastCompletedAt = latest?.completedAt;
    task.nextDueDate = completion.scheduledFor;
    taskStore.put(task);
    await enqueueMutation(tx, "task", task.id, "upsert", withoutId(task));
  }
  completionStore.delete(id);
  await enqueueMutation(tx, "completion", id, "delete");
  await done;
}

export async function importDocument(document: NestiDocument): Promise<void> {
  const current = await snapshot();
  const usedRoomIds = new Set(current.rooms.map((room) => room.id));
  const usedTaskIds = new Set(current.tasks.map((task) => task.id));
  const db = await database();
  const tx = db.transaction(["rooms", "tasks", ...syncStores], "readwrite");
  const done = transactionDone(tx);
  for (const [roomOffset, room] of document.rooms.sort((a, b) => a.sortOrder - b.sortOrder).entries()) {
    const roomId = usedRoomIds.has(room.id) ? crypto.randomUUID() : room.id;
    usedRoomIds.add(roomId);
    const localRoom: RoomRecord = { id: roomId, name: room.name.trim(), notes: room.notes ?? "", icon: room.icon ?? "door.left.hand.open", sortOrder: current.rooms.length + roomOffset };
    tx.objectStore("rooms").put(localRoom);
    await enqueueMutation(tx, "room", roomId, "upsert", withoutId(localRoom));
    for (const task of room.tasks.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const taskId = usedTaskIds.has(task.id) ? crypto.randomUUID() : task.id;
      usedTaskIds.add(taskId);
      const localTask: TaskRecord = {
        id: taskId, roomId, name: task.name.trim(), notes: task.notes ?? "", sortOrder: task.sortOrder,
        reminder: task.reminder ?? { enabled: false, hour: 9, minute: 0 }, createdAt: new Date().toISOString()
      };
      if (task.estimatedMinutes != null) localTask.estimatedMinutes = task.estimatedMinutes;
      if (task.schedule != null) localTask.schedule = task.schedule;
      if (task.lastCompletedAt != null) localTask.lastCompletedAt = task.lastCompletedAt;
      const due = normalizeImportedDueDate(task);
      if (due != null) localTask.nextDueDate = due;
      if (task.metadata != null) localTask.metadata = task.metadata;
      tx.objectStore("tasks").put(localTask);
      await enqueueMutation(tx, "task", taskId, "upsert", withoutId(localTask));
    }
  }
  await done;
}

export async function syncState(): Promise<{ connection?: SyncConnection; pending: number; conflicts: SyncConflict[] }> {
  const db = await database();
  const tx = db.transaction(syncStores, "readonly");
  const [connection, pending, conflicts] = await Promise.all([
    request(tx.objectStore("sync").get("connection")) as Promise<SyncConnection | undefined>,
    request(tx.objectStore("outbox").count()),
    request(tx.objectStore("conflicts").getAll()) as Promise<SyncConflict[]>
  ]);
  return { connection, pending, conflicts };
}

export async function pendingMutations(limit = 500): Promise<PendingSyncMutation[]> {
  const db = await database();
  const tx = db.transaction(["outbox", "conflicts"], "readwrite");
  const done = transactionDone(tx);
  const outbox = tx.objectStore("outbox");
  const conflictStore = tx.objectStore("conflicts");
  const conflicts = await request(conflictStore.getAll()) as SyncConflict[];
  const blockedKeys = new Set<string>();
  for (const conflict of conflicts) {
    if (conflict.reason === "missing_parent") {
      const pending = await request(outbox.index("entityKey").get(conflict.id)) as PendingSyncMutation | undefined;
      if (pending) {
        outbox.delete(pending.id);
        outbox.put({ ...pending, id: crypto.randomUUID(), baseRevision: conflict.serverRevision, createdAt: new Date().toISOString() });
        conflictStore.delete(conflict.id);
        continue;
      }
    }
    blockedKeys.add(conflict.id);
  }
  const mutations = await request(outbox.getAll()) as PendingSyncMutation[];
  await done;
  return mutations
    .filter((mutation) => !blockedKeys.has(mutation.entityKey))
    .sort((left, right) => mutationApplicationPriority(left) - mutationApplicationPriority(right)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export async function connectToSnapshot(
  connection: SyncConnection,
  remote: ServerSnapshot,
  mode: "use-local" | "use-server"
): Promise<void> {
  const local = await snapshot();
  const db = await database();
  const tx = db.transaction(allStores, "readwrite");
  const done = transactionDone(tx);
  for (const name of syncStores) tx.objectStore(name).clear();
  tx.objectStore("sync").put(connection);

  if (mode === "use-server") {
    for (const name of dataStores) tx.objectStore(name).clear();
    tx.objectStore("settings").put({ id: "settings", homeName: remote.home.payload.name, activeProfileId: remote.profiles[0]?.id });
    installSnapshotRecords(tx, remote);
  } else {
    tx.objectStore("revisions").put({ id: entityKey("home", connection.homeId), revision: remote.home.revision } satisfies SyncRevision);
    await enqueueMutation(tx, "home", connection.homeId, "upsert", { name: local.settings.homeName });
    for (const profile of local.profiles) await enqueueMutation(tx, "profile", profile.id, "upsert", withoutId(profile));
    for (const room of local.rooms) await enqueueMutation(tx, "room", room.id, "upsert", withoutId(room));
    for (const task of local.tasks) await enqueueMutation(tx, "task", task.id, "upsert", withoutId(task));
    for (const completion of local.completions) await enqueueMutation(tx, "completion", completion.id, "upsert", withoutId(completion));
  }
  await done;
}

function installSnapshotRecords(tx: IDBTransaction, remote: ServerSnapshot): void {
  tx.objectStore("revisions").put({ id: entityKey("home", remote.home.id), revision: remote.home.revision } satisfies SyncRevision);
  for (const item of remote.profiles) {
    tx.objectStore("profiles").put({ id: item.id, ...item.payload });
    tx.objectStore("revisions").put({ id: entityKey("profile", item.id), revision: item.revision } satisfies SyncRevision);
  }
  for (const item of remote.rooms) {
    tx.objectStore("rooms").put({ id: item.id, ...item.payload });
    tx.objectStore("revisions").put({ id: entityKey("room", item.id), revision: item.revision } satisfies SyncRevision);
  }
  for (const item of remote.tasks) {
    tx.objectStore("tasks").put({ id: item.id, ...item.payload });
    tx.objectStore("revisions").put({ id: entityKey("task", item.id), revision: item.revision } satisfies SyncRevision);
  }
  for (const item of remote.completions) {
    tx.objectStore("completions").put({ id: item.id, ...item.payload });
    tx.objectStore("revisions").put({ id: entityKey("completion", item.id), revision: item.revision } satisfies SyncRevision);
  }
}

function storeFor(type: Exclude<SyncEntityType, "home">): "profiles" | "rooms" | "tasks" | "completions" {
  if (type === "profile") return "profiles";
  if (type === "room") return "rooms";
  if (type === "task") return "tasks";
  return "completions";
}

async function applyChange(tx: IDBTransaction, change: SyncChange, blockedKeys: Set<string>): Promise<void> {
  const key = entityKey(change.entityType, change.entityId);
  if (blockedKeys.has(key)) return;
  tx.objectStore("revisions").put({ id: key, revision: change.revision } satisfies SyncRevision);
  if (change.entityType === "home") {
    if (change.operation === "upsert" && change.payload) {
      const store = tx.objectStore("settings");
      const settings = await request(store.get("settings")) as SettingsRecord | undefined;
      store.put({ ...(settings ?? { id: "settings" }), homeName: (change.payload as { name: string }).name });
    }
    return;
  }
  const store = tx.objectStore(storeFor(change.entityType));
  if (change.operation === "delete") store.delete(change.entityId);
  else if (change.payload) store.put({ id: change.entityId, ...change.payload });
}

export async function applySyncResponse(response: SyncResponse): Promise<void> {
  const db = await database();
  const tx = db.transaction(allStores, "readwrite");
  const done = transactionDone(tx);
  const connection = await request(tx.objectStore("sync").get("connection")) as SyncConnection | undefined;
  if (!connection) throw new Error("The browser is no longer connected to a server.");
  const existingConflicts = await request(tx.objectStore("conflicts").getAll()) as SyncConflict[];
  const blockedKeys = new Set(existingConflicts.map((conflict) => conflict.id));
  for (const conflict of response.conflicts) blockedKeys.add(entityKey(conflict.entityType, conflict.entityId));
  for (const acknowledgement of response.acknowledgements) {
    tx.objectStore("outbox").delete(acknowledgement.mutationId);
    tx.objectStore("revisions").put({ id: entityKey(acknowledgement.entityType, acknowledgement.entityId), revision: acknowledgement.revision } satisfies SyncRevision);
  }
  for (const conflict of response.conflicts) {
    tx.objectStore("conflicts").put({ id: entityKey(conflict.entityType, conflict.entityId), ...conflict } satisfies SyncConflict);
  }
  for (const change of response.changes) await applyChange(tx, change, blockedKeys);
  tx.objectStore("sync").put({ ...connection, cursor: response.cursor, lastSyncedAt: new Date().toISOString() });
  await done;
}

export async function resolveConflict(id: string, choice: "server" | "local"): Promise<void> {
  const db = await database();
  const tx = db.transaction(allStores, "readwrite");
  const done = transactionDone(tx);
  const conflict = await request(tx.objectStore("conflicts").get(id)) as SyncConflict | undefined;
  if (!conflict) return;
  const pending = await request(tx.objectStore("outbox").index("entityKey").get(id)) as PendingSyncMutation | undefined;
  if (pending) tx.objectStore("outbox").delete(pending.id);
  if (choice === "local" && pending && conflict.reason !== "deleted") {
    tx.objectStore("outbox").put({ ...pending, id: crypto.randomUUID(), baseRevision: conflict.serverRevision, createdAt: new Date().toISOString() });
  } else {
    const change: SyncChange = {
      cursor: "0",
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      operation: conflict.serverPayload ? "upsert" : "delete",
      revision: conflict.serverRevision
    };
    if (conflict.serverPayload) change.payload = conflict.serverPayload;
    await applyChange(tx, change, new Set());
  }
  tx.objectStore("conflicts").delete(id);
  await done;
}

export async function disconnectSync(): Promise<void> {
  const db = await database();
  const tx = db.transaction(syncStores, "readwrite");
  const done = transactionDone(tx);
  for (const name of syncStores) tx.objectStore(name).clear();
  await done;
}

export async function resetDatabase(): Promise<void> {
  const db = await database();
  const tx = db.transaction(allStores, "readwrite");
  const done = transactionDone(tx);
  for (const name of allStores) tx.objectStore(name).clear();
  await done;
}
