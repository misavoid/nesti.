import { dateKey, initialDueDate, parseDateKey } from "./dates";
import type { AppSnapshot, NestiDocument, NestiRoom, NestiTask, RecurrenceRule, Weekday } from "./types";

const MAX_BYTES = 5 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const weekdayValues: Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected an object at ${path}.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, required = false): string | undefined {
  if (value == null && !required) return undefined;
  if (typeof value !== "string") throw new Error(`Expected text at ${path}.`);
  if (required && !value.trim()) throw new Error(`${path} is empty.`);
  return value;
}

function integer(value: unknown, path: string, fallback?: number): number {
  if (value == null && fallback != null) return fallback;
  if (!Number.isInteger(value)) throw new Error(`Expected an integer at ${path}.`);
  return value as number;
}

function identifier(value: unknown, path: string): string {
  if (value == null) return crypto.randomUUID();
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error(`Invalid identifier at ${path}.`);
  return value.toLowerCase();
}

function timestamp(value: unknown, path: string, calendarOnly = false): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error(`Expected a date at ${path}.`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parseDateKey(value);
    return calendarOnly ? value : new Date(`${value}T00:00:00`).toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid date at ${path}.`);
  return calendarOnly ? dateKey(date) : date.toISOString();
}

function schedule(value: unknown, path: string): RecurrenceRule | undefined {
  if (value == null) return undefined;
  const raw = object(value, path);
  if (raw.type === "interval") {
    const days = integer(raw.days, `${path}.days`);
    if (days < 1 || days > 3650) throw new Error(`${path}.days must be between 1 and 3650.`);
    const basis = raw.basis ?? "completion";
    if (basis !== "completion" && basis !== "scheduled") throw new Error(`Invalid basis at ${path}.basis.`);
    return { type: "interval", days, basis };
  }
  if (raw.type === "weekdays") {
    if (!Array.isArray(raw.days) || raw.days.length === 0 || raw.days.some((day) => !weekdayValues.includes(day as Weekday))) {
      throw new Error(`${path}.days must contain valid weekdays.`);
    }
    return { type: "weekdays", days: [...new Set(raw.days as Weekday[])] };
  }
  if (raw.type === "monthly") {
    const intervalMonths = integer(raw.intervalMonths, `${path}.intervalMonths`, 1);
    const day = raw.day == null ? undefined : integer(raw.day, `${path}.day`);
    const basis = raw.basis ?? (day == null ? "completion" : "scheduled");
    if (basis !== "completion" && basis !== "scheduled") throw new Error(`Invalid basis at ${path}.basis.`);
    if (intervalMonths < 1 || intervalMonths > 120) throw new Error(`${path}.intervalMonths must be between 1 and 120.`);
    if (day != null && (day < 1 || day > 31)) throw new Error(`${path}.day must be between 1 and 31.`);
    if (basis === "scheduled" && day == null) throw new Error(`${path} needs a day for a scheduled monthly rule.`);
    return { type: "monthly", day, intervalMonths, basis };
  }
  throw new Error(`Unknown recurrence type at ${path}.type.`);
}

function task(value: unknown, roomIndex: number, taskIndex: number): NestiTask {
  const path = `$.rooms[${roomIndex}].tasks[${taskIndex}]`;
  const raw = object(value, path);
  const estimatedMinutes = raw.estimatedMinutes == null ? undefined : integer(raw.estimatedMinutes, `${path}.estimatedMinutes`);
  if (estimatedMinutes != null && (estimatedMinutes < 1 || estimatedMinutes > 1440)) throw new Error(`${path}.estimatedMinutes must be between 1 and 1440.`);
  const reminderRaw = raw.reminder == null ? undefined : object(raw.reminder, `${path}.reminder`);
  const reminder = reminderRaw ? {
    enabled: reminderRaw.enabled === true,
    hour: integer(reminderRaw.hour, `${path}.reminder.hour`, 9),
    minute: integer(reminderRaw.minute, `${path}.reminder.minute`, 0)
  } : undefined;
  if (reminder && (reminder.hour < 0 || reminder.hour > 23 || reminder.minute < 0 || reminder.minute > 59)) throw new Error(`${path}.reminder has an invalid time.`);
  const metadataRaw = raw.metadata == null ? undefined : object(raw.metadata, `${path}.metadata`);
  if (metadataRaw && Object.values(metadataRaw).some((item) => typeof item !== "string")) throw new Error(`${path}.metadata values must be text.`);
  const nextValue = raw.nextDueDate ?? raw.nextDueAt ?? raw.dueDate ?? raw.startDate;
  return {
    id: identifier(raw.id, `${path}.id`),
    name: text(raw.name, `${path}.name`, true)!,
    notes: text(raw.notes, `${path}.notes`),
    estimatedMinutes,
    sortOrder: integer(raw.sortOrder, `${path}.sortOrder`, 0),
    schedule: schedule(raw.schedule, `${path}.schedule`),
    lastCompletedAt: timestamp(raw.lastCompletedAt, `${path}.lastCompletedAt`),
    nextDueDate: timestamp(nextValue, `${path}.nextDueDate`, true),
    reminder,
    metadata: metadataRaw as Record<string, string> | undefined
  };
}

export function decodeDocument(source: string): NestiDocument {
  if (new TextEncoder().encode(source).byteLength > MAX_BYTES) throw new Error("This file is larger than the 5 MB import limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error("The file is not valid nesti. JSON."); }
  const raw = object(parsed, "$");
  if (raw.version !== 1) throw new Error(`This file uses unsupported format version ${String(raw.version)}.`);
  if (!Array.isArray(raw.rooms)) throw new Error("Expected rooms at $.rooms.");
  if (raw.rooms.length === 0) throw new Error("The plan contains no rooms.");
  if (raw.rooms.length > 250) throw new Error("The plan exceeds the 250 room limit.");
  let taskCount = 0;
  const ids = new Set<string>();
  const documentId = identifier(raw.id, "$.id");
  ids.add(documentId);
  const rooms: NestiRoom[] = raw.rooms.map((value, roomIndex) => {
    const path = `$.rooms[${roomIndex}]`;
    const roomRaw = object(value, path);
    if (!Array.isArray(roomRaw.tasks ?? [])) throw new Error(`Expected tasks at ${path}.tasks.`);
    const roomId = identifier(roomRaw.id, `${path}.id`);
    if (ids.has(roomId)) throw new Error(`${path} has a duplicate identifier.`);
    ids.add(roomId);
    const tasks = (roomRaw.tasks as unknown[] | undefined ?? []).map((item, taskIndex) => task(item, roomIndex, taskIndex));
    taskCount += tasks.length;
    for (const item of tasks) {
      if (ids.has(item.id)) throw new Error(`${path} has a duplicate task identifier.`);
      ids.add(item.id);
    }
    return {
      id: roomId,
      name: text(roomRaw.name, `${path}.name`, true)!,
      sortOrder: integer(roomRaw.sortOrder, `${path}.sortOrder`, 0),
      icon: text(roomRaw.icon, `${path}.icon`),
      notes: text(roomRaw.notes, `${path}.notes`),
      tasks
    };
  });
  if (taskCount > 10_000) throw new Error("The plan exceeds the 10,000 task limit.");
  return {
    version: 1,
    id: documentId,
    name: text(raw.name, "$.name", true)!,
    exportedAt: timestamp(raw.exportedAt, "$.exportedAt") ?? new Date().toISOString(),
    metadata: raw.metadata as NestiDocument["metadata"],
    rooms
  };
}

export function encodeDocument(snapshot: AppSnapshot, selectedRoomId?: string): string {
  const selectedRooms = snapshot.rooms.filter((room) => !selectedRoomId || room.id === selectedRoomId).sort((a, b) => a.sortOrder - b.sortOrder);
  const document: NestiDocument = {
    version: 1,
    id: crypto.randomUUID(),
    name: selectedRoomId ? `${snapshot.settings.homeName} - ${selectedRooms[0]?.name ?? "Room"}` : snapshot.settings.homeName,
    exportedAt: new Date().toISOString(),
    metadata: { generator: "nesti. web 0.1" },
    rooms: selectedRooms.map((room) => ({
      id: room.id,
      name: room.name,
      sortOrder: room.sortOrder,
      icon: room.icon,
      notes: room.notes || undefined,
      tasks: snapshot.tasks.filter((item) => item.roomId === room.id).sort((a, b) => a.sortOrder - b.sortOrder).map((item) => ({
        id: item.id,
        name: item.name,
        notes: item.notes || undefined,
        estimatedMinutes: item.estimatedMinutes,
        sortOrder: item.sortOrder,
        schedule: item.schedule,
        lastCompletedAt: item.lastCompletedAt,
        nextDueDate: item.nextDueDate,
        reminder: item.reminder,
        metadata: item.metadata
      }))
    }))
  };
  return JSON.stringify(document, null, 2);
}

export function documentSummary(document: NestiDocument): { rooms: number; tasks: number } {
  return { rooms: document.rooms.length, tasks: document.rooms.reduce((sum, room) => sum + room.tasks.length, 0) };
}

export function normalizeImportedDueDate(task: NestiTask): string {
  return task.nextDueDate ?? initialDueDate(task.schedule);
}
