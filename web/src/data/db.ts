import { dateKey, nextDueDate } from "../core/dates";
import { normalizeImportedDueDate } from "../core/codec";
import type { AppSnapshot, CompletionRecord, NestiDocument, RoomRecord, SettingsRecord, TaskRecord } from "../core/types";

const DB_NAME = "nesti";
const DB_VERSION = 1;
const stores = ["rooms", "tasks", "completions", "settings"] as const;
type StoreName = typeof stores[number];

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
    }
    if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
  };
  return request(open);
}

export async function snapshot(): Promise<AppSnapshot> {
  const db = await database();
  const transaction = db.transaction(stores, "readonly");
  const [rooms, tasks, completions, settings] = await Promise.all([
    request(transaction.objectStore("rooms").getAll()) as Promise<RoomRecord[]>,
    request(transaction.objectStore("tasks").getAll()) as Promise<TaskRecord[]>,
    request(transaction.objectStore("completions").getAll()) as Promise<CompletionRecord[]>,
    request(transaction.objectStore("settings").get("settings")) as Promise<SettingsRecord | undefined>
  ]);
  return {
    rooms: rooms.sort((a, b) => a.sortOrder - b.sortOrder),
    tasks: tasks.sort((a, b) => a.sortOrder - b.sortOrder),
    completions: completions.sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    settings: settings ?? { id: "settings", homeName: "My Home" }
  };
}

async function put(storeName: StoreName, value: object): Promise<void> {
  const db = await database();
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
}

export const saveRoom = (room: RoomRecord) => put("rooms", room);
export const saveTask = (task: TaskRecord) => put("tasks", task);
export const saveSettings = (settings: SettingsRecord) => put("settings", settings);

export async function deleteTask(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(["tasks", "completions"], "readwrite");
  tx.objectStore("tasks").delete(id);
  const index = tx.objectStore("completions").index("taskId");
  for (const completion of await request(index.getAll(IDBKeyRange.only(id))) as CompletionRecord[]) tx.objectStore("completions").delete(completion.id);
  await transactionDone(tx);
}

export async function deleteRoom(id: string): Promise<void> {
  const data = await snapshot();
  const taskIds = new Set(data.tasks.filter((task) => task.roomId === id).map((task) => task.id));
  const db = await database();
  const tx = db.transaction(["rooms", "tasks", "completions"], "readwrite");
  tx.objectStore("rooms").delete(id);
  for (const taskId of taskIds) tx.objectStore("tasks").delete(taskId);
  for (const completion of data.completions.filter((item) => taskIds.has(item.taskId))) tx.objectStore("completions").delete(completion.id);
  await transactionDone(tx);
}

export async function completeTask(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(["tasks", "completions"], "readwrite");
  const taskStore = tx.objectStore("tasks");
  const task = await request(taskStore.get(id)) as TaskRecord | undefined;
  if (!task) throw new Error("Task not found.");
  const now = new Date();
  const completion: CompletionRecord = { id: crypto.randomUUID(), taskId: id, completedAt: now.toISOString(), scheduledFor: task.nextDueDate };
  task.lastCompletedAt = completion.completedAt;
  task.nextDueDate = task.schedule ? nextDueDate(task.schedule, dateKey(now), completion.scheduledFor) : undefined;
  taskStore.put(task);
  tx.objectStore("completions").put(completion);
  await transactionDone(tx);
}

export async function undoCompletion(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(["tasks", "completions"], "readwrite");
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
  }
  completionStore.delete(id);
  await transactionDone(tx);
}

export async function importDocument(document: NestiDocument): Promise<void> {
  const current = await snapshot();
  const usedRoomIds = new Set(current.rooms.map((room) => room.id));
  const usedTaskIds = new Set(current.tasks.map((task) => task.id));
  const db = await database();
  const tx = db.transaction(["rooms", "tasks"], "readwrite");
  document.rooms.sort((a, b) => a.sortOrder - b.sortOrder).forEach((room, roomOffset) => {
    const roomId = usedRoomIds.has(room.id) ? crypto.randomUUID() : room.id;
    usedRoomIds.add(roomId);
    tx.objectStore("rooms").put({ id: roomId, name: room.name.trim(), notes: room.notes ?? "", icon: room.icon ?? "door.left.hand.open", sortOrder: current.rooms.length + roomOffset });
    room.tasks.sort((a, b) => a.sortOrder - b.sortOrder).forEach((task) => {
      const taskId = usedTaskIds.has(task.id) ? crypto.randomUUID() : task.id;
      usedTaskIds.add(taskId);
      tx.objectStore("tasks").put({
        id: taskId, roomId, name: task.name.trim(), notes: task.notes ?? "", estimatedMinutes: task.estimatedMinutes,
        sortOrder: task.sortOrder, schedule: task.schedule, lastCompletedAt: task.lastCompletedAt,
        nextDueDate: normalizeImportedDueDate(task), reminder: task.reminder ?? { enabled: false, hour: 9, minute: 0 },
        metadata: task.metadata, createdAt: new Date().toISOString()
      } satisfies TaskRecord);
    });
  });
  await transactionDone(tx);
}

export async function resetDatabase(): Promise<void> {
  const db = await database();
  const tx = db.transaction(stores, "readwrite");
  stores.forEach((name) => tx.objectStore(name).clear());
  await transactionDone(tx);
}
