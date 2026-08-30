export const SYNC_PROTOCOL_VERSION = 1 as const;
export const MAX_SYNC_MUTATIONS = 500;
export const MAX_SYNC_CHANGES = 500;

export type EntityType = "home" | "profile" | "room" | "task" | "completion";
export type MutationOperation = "upsert" | "delete";

export interface HomePayload {
  name: string;
}

export interface RoomPayload {
  name: string;
  notes: string;
  icon: string;
  sortOrder: number;
}

export interface ProfilePayload {
  name: string;
  color: string;
  sortOrder: number;
}

export type RecurrenceRule =
  | { type: "interval"; days: number; basis: "completion" | "scheduled" }
  | { type: "weekdays"; days: Weekday[] }
  | { type: "monthly"; day?: number; intervalMonths: number; basis: "completion" | "scheduled" };

export type Weekday = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

export interface ReminderPayload {
  enabled: boolean;
  hour: number;
  minute: number;
}

export interface TaskPayload {
  roomId: string;
  name: string;
  notes: string;
  estimatedMinutes?: number;
  sortOrder: number;
  schedule?: RecurrenceRule;
  lastCompletedAt?: string;
  nextDueDate?: string;
  reminder: ReminderPayload;
  metadata?: Record<string, string>;
  createdAt: string;
}

export interface CompletionPayload {
  taskId: string;
  profileId?: string;
  completedAt: string;
  scheduledFor?: string;
}

export interface EntityPayloads {
  home: HomePayload;
  profile: ProfilePayload;
  room: RoomPayload;
  task: TaskPayload;
  completion: CompletionPayload;
}

export type EntityPayload = EntityPayloads[EntityType];

export interface SyncMutation {
  id: string;
  entityType: EntityType;
  entityId: string;
  operation: MutationOperation;
  baseRevision: string;
  payload?: EntityPayload;
}

export interface SyncRequest {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  cursor: string;
  mutations: SyncMutation[];
}

export interface MutationAcknowledgement {
  mutationId: string;
  entityType: EntityType;
  entityId: string;
  revision: string;
}

export interface MutationConflict {
  mutationId: string;
  entityType: EntityType;
  entityId: string;
  reason: "revision_mismatch" | "deleted" | "missing_parent" | "has_children" | "limit_exceeded" | "home_cannot_be_deleted";
  serverRevision: string;
  serverPayload?: EntityPayload;
}

export interface SyncChange {
  cursor: string;
  entityType: EntityType;
  entityId: string;
  operation: MutationOperation;
  revision: string;
  payload?: EntityPayload;
}

export interface SyncResponse {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  cursor: string;
  hasMore: boolean;
  acknowledgements: MutationAcknowledgement[];
  conflicts: MutationConflict[];
  changes: SyncChange[];
}

export interface SyncSnapshot {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  cursor: string;
  home: { id: string; revision: string; payload: HomePayload };
  profiles: Array<{ id: string; revision: string; payload: ProfilePayload }>;
  rooms: Array<{ id: string; revision: string; payload: RoomPayload }>;
  tasks: Array<{ id: string; revision: string; payload: TaskPayload }>;
  completions: Array<{ id: string; revision: string; payload: CompletionPayload }>;
}

export class ProtocolError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimalPattern = /^(0|[1-9][0-9]*)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const weekdays: Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError("invalid_request", `Expected an object at ${path}.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new ProtocolError("invalid_request", `Expected text at ${path}.`);
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) throw new ProtocolError("invalid_request", `${path} is empty.`);
  if (value.length > maximum) throw new ProtocolError("invalid_request", `${path} exceeds ${maximum} characters.`);
  return value;
}

function optionalString(value: unknown, path: string, maximum: number): string | undefined {
  return value == null ? undefined : string(value, path, maximum, true);
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ProtocolError("invalid_request", `${path} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

export function parseIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ProtocolError("invalid_request", `Invalid UUID at ${path}.`);
  }
  return value.toLowerCase();
}

export function parseRevision(value: unknown, path: string): string {
  if (typeof value !== "string" || !decimalPattern.test(value)) {
    throw new ProtocolError("invalid_request", `${path} must be a non-negative decimal string.`);
  }
  return value;
}

function timestamp(value: unknown, path: string, allowCalendarDate = false): string {
  if (typeof value !== "string") throw new ProtocolError("invalid_request", `Expected a date at ${path}.`);
  if (allowCalendarDate && datePattern.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value)) return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || !value.includes("T")) {
    throw new ProtocolError("invalid_request", `Expected an ISO-8601 timestamp at ${path}.`);
  }
  return parsed.toISOString();
}

function recurrence(value: unknown, path: string): RecurrenceRule | undefined {
  if (value == null) return undefined;
  const raw = record(value, path);
  if (raw.type === "interval") {
    const basis = raw.basis ?? "completion";
    if (basis !== "completion" && basis !== "scheduled") throw new ProtocolError("invalid_request", `Invalid recurrence basis at ${path}.basis.`);
    return { type: "interval", days: integer(raw.days, `${path}.days`, 1, 3650), basis };
  }
  if (raw.type === "weekdays") {
    if (!Array.isArray(raw.days) || raw.days.length === 0 || raw.days.some((day) => !weekdays.includes(day as Weekday))) {
      throw new ProtocolError("invalid_request", `${path}.days must contain valid weekdays.`);
    }
    return { type: "weekdays", days: [...new Set(raw.days as Weekday[])] };
  }
  if (raw.type === "monthly") {
    const intervalMonths = integer(raw.intervalMonths ?? 1, `${path}.intervalMonths`, 1, 120);
    const day = raw.day == null ? undefined : integer(raw.day, `${path}.day`, 1, 31);
    const basis = raw.basis ?? (day == null ? "completion" : "scheduled");
    if (basis !== "completion" && basis !== "scheduled") throw new ProtocolError("invalid_request", `Invalid recurrence basis at ${path}.basis.`);
    if (basis === "scheduled" && day == null) throw new ProtocolError("invalid_request", `${path} needs a day for a scheduled monthly rule.`);
    return day == null ? { type: "monthly", intervalMonths, basis } : { type: "monthly", day, intervalMonths, basis };
  }
  throw new ProtocolError("invalid_request", `Unknown recurrence type at ${path}.type.`);
}

function metadata(value: unknown, path: string): Record<string, string> | undefined {
  if (value == null) return undefined;
  const raw = record(value, path);
  const entries = Object.entries(raw);
  if (entries.length > 100) throw new ProtocolError("invalid_request", `${path} exceeds 100 entries.`);
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (key.length > 100 || typeof item !== "string" || item.length > 1000) {
      throw new ProtocolError("invalid_request", `${path} contains an invalid entry.`);
    }
    result[key] = item;
  }
  return result;
}

function parseHome(value: unknown, path: string): HomePayload {
  const raw = record(value, path);
  return { name: string(raw.name, `${path}.name`, 200).trim() };
}

function parseRoom(value: unknown, path: string): RoomPayload {
  const raw = record(value, path);
  return {
    name: string(raw.name, `${path}.name`, 200).trim(),
    notes: string(raw.notes ?? "", `${path}.notes`, 10_000, true),
    icon: string(raw.icon ?? "door.left.hand.open", `${path}.icon`, 200),
    sortOrder: integer(raw.sortOrder, `${path}.sortOrder`, -1_000_000, 1_000_000)
  };
}

function parseProfile(value: unknown, path: string): ProfilePayload {
  const raw = record(value, path);
  const color = string(raw.color, `${path}.color`, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ProtocolError("invalid_request", `${path}.color must be a six-digit hex color.`);
  return {
    name: string(raw.name, `${path}.name`, 100).trim(),
    color: color.toLowerCase(),
    sortOrder: integer(raw.sortOrder, `${path}.sortOrder`, -1_000_000, 1_000_000)
  };
}

function parseTask(value: unknown, path: string): TaskPayload {
  const raw = record(value, path);
  const reminderRaw = record(raw.reminder, `${path}.reminder`);
  const reminder: ReminderPayload = {
    enabled: reminderRaw.enabled === true,
    hour: integer(reminderRaw.hour, `${path}.reminder.hour`, 0, 23),
    minute: integer(reminderRaw.minute, `${path}.reminder.minute`, 0, 59)
  };
  const result: TaskPayload = {
    roomId: parseIdentifier(raw.roomId, `${path}.roomId`),
    name: string(raw.name, `${path}.name`, 200).trim(),
    notes: string(raw.notes ?? "", `${path}.notes`, 10_000, true),
    sortOrder: integer(raw.sortOrder, `${path}.sortOrder`, -1_000_000, 1_000_000),
    reminder,
    createdAt: timestamp(raw.createdAt, `${path}.createdAt`)
  };
  if (raw.estimatedMinutes != null) result.estimatedMinutes = integer(raw.estimatedMinutes, `${path}.estimatedMinutes`, 1, 1440);
  const parsedSchedule = recurrence(raw.schedule, `${path}.schedule`);
  if (parsedSchedule) result.schedule = parsedSchedule;
  if (raw.lastCompletedAt != null) result.lastCompletedAt = timestamp(raw.lastCompletedAt, `${path}.lastCompletedAt`);
  if (raw.nextDueDate != null) result.nextDueDate = timestamp(raw.nextDueDate, `${path}.nextDueDate`, true);
  const parsedMetadata = metadata(raw.metadata, `${path}.metadata`);
  if (parsedMetadata) result.metadata = parsedMetadata;
  return result;
}

function parseCompletion(value: unknown, path: string): CompletionPayload {
  const raw = record(value, path);
  const result: CompletionPayload = {
    taskId: parseIdentifier(raw.taskId, `${path}.taskId`),
    completedAt: timestamp(raw.completedAt, `${path}.completedAt`)
  };
  if (raw.profileId != null) result.profileId = parseIdentifier(raw.profileId, `${path}.profileId`);
  if (raw.scheduledFor != null) result.scheduledFor = timestamp(raw.scheduledFor, `${path}.scheduledFor`, true);
  return result;
}

export function parseEntityPayload(type: EntityType, value: unknown, path = "$.payload"): EntityPayload {
  switch (type) {
    case "home": return parseHome(value, path);
    case "profile": return parseProfile(value, path);
    case "room": return parseRoom(value, path);
    case "task": return parseTask(value, path);
    case "completion": return parseCompletion(value, path);
  }
}

export function parseSyncRequest(value: unknown): SyncRequest {
  const raw = record(value, "$");
  if (raw.protocolVersion !== SYNC_PROTOCOL_VERSION) {
    throw new ProtocolError("unsupported_protocol", `Unsupported sync protocol version ${String(raw.protocolVersion)}.`);
  }
  if (!Array.isArray(raw.mutations) || raw.mutations.length > MAX_SYNC_MUTATIONS) {
    throw new ProtocolError("invalid_request", `$.mutations must contain at most ${MAX_SYNC_MUTATIONS} entries.`);
  }
  const mutations = raw.mutations.map((value, index): SyncMutation => {
    const path = `$.mutations[${index}]`;
    const mutation = record(value, path);
    if (!(["home", "profile", "room", "task", "completion"] as unknown[]).includes(mutation.entityType)) {
      throw new ProtocolError("invalid_request", `Invalid entity type at ${path}.entityType.`);
    }
    if (mutation.operation !== "upsert" && mutation.operation !== "delete") {
      throw new ProtocolError("invalid_request", `Invalid operation at ${path}.operation.`);
    }
    const entityType = mutation.entityType as EntityType;
    const operation = mutation.operation;
    const parsed: SyncMutation = {
      id: parseIdentifier(mutation.id, `${path}.id`),
      entityType,
      entityId: parseIdentifier(mutation.entityId, `${path}.entityId`),
      operation,
      baseRevision: parseRevision(mutation.baseRevision, `${path}.baseRevision`)
    };
    if (operation === "upsert") parsed.payload = parseEntityPayload(entityType, mutation.payload, `${path}.payload`);
    if (operation === "delete" && mutation.payload != null) {
      throw new ProtocolError("invalid_request", `${path}.payload must be omitted for a delete.`);
    }
    return parsed;
  });
  const ids = new Set(mutations.map((mutation) => mutation.id));
  if (ids.size !== mutations.length) throw new ProtocolError("invalid_request", "Mutation identifiers must be unique within a request.");
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    cursor: parseRevision(raw.cursor, "$.cursor"),
    mutations
  };
}

export function parsePairRequest(value: unknown): { code: string; deviceName: string } {
  const raw = record(value, "$");
  const code = string(raw.code, "$.code", 64).replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-9]{8,32}$/.test(code)) throw new ProtocolError("invalid_request", "The pairing code is invalid.");
  return { code, deviceName: string(raw.deviceName, "$.deviceName", 200).trim() };
}

export function parseBootstrapRequest(value: unknown): { homeName: string; deviceName: string } {
  const raw = record(value, "$");
  return {
    homeName: string(raw.homeName, "$.homeName", 200).trim(),
    deviceName: string(raw.deviceName, "$.deviceName", 200).trim()
  };
}
