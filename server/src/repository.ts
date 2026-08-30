import { randomUUID } from "node:crypto";
import type pg from "pg";
import { generateDeviceToken, generatePairingCode, hashDeviceToken, hashPairingCode } from "./auth.js";
import { withTransaction } from "./database.js";
import { ApiError } from "./errors.js";
import {
  MAX_SYNC_CHANGES,
  mutationApplicationPriority,
  SYNC_PROTOCOL_VERSION,
  type CompletionPayload,
  type EntityPayload,
  type EntityType,
  type HomePayload,
  type MutationAcknowledgement,
  type MutationConflict,
  type ProfilePayload,
  type RoomPayload,
  type SyncChange,
  type SyncMutation,
  type SyncRequest,
  type SyncResponse,
  type SyncSnapshot,
  type TaskPayload
} from "./protocol.js";

export interface DeviceIdentity {
  id: string;
  homeId: string;
  name: string;
}

export interface PairingResult {
  deviceToken: string;
  deviceId: string;
  homeId: string;
  snapshot: SyncSnapshot;
}

interface StoredEntity {
  revision: string;
  deleted: boolean;
  payload?: EntityPayload;
}

type StoredMutationResult =
  | { kind: "acknowledgement"; value: MutationAcknowledgement }
  | { kind: "conflict"; value: MutationConflict };

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optional<T>(value: T | null): T | undefined {
  return value == null ? undefined : value;
}

function homePayload(row: Record<string, unknown>): HomePayload {
  return { name: row.name as string };
}

function roomPayload(row: Record<string, unknown>): RoomPayload {
  return {
    name: row.name as string,
    notes: row.notes as string,
    icon: row.icon as string,
    sortOrder: row.sort_order as number
  };
}

function profilePayload(row: Record<string, unknown>): ProfilePayload {
  return {
    name: row.name as string,
    color: row.color as string,
    sortOrder: row.sort_order as number
  };
}

function taskPayload(row: Record<string, unknown>): TaskPayload {
  const payload: TaskPayload = {
    roomId: row.room_id as string,
    name: row.name as string,
    notes: row.notes as string,
    sortOrder: row.sort_order as number,
    reminder: row.reminder as TaskPayload["reminder"],
    createdAt: iso(row.created_at as Date | string)
  };
  const estimatedMinutes = optional(row.estimated_minutes as number | null);
  const schedule = optional(row.schedule as TaskPayload["schedule"] | null);
  const lastCompletedAt = optional(row.last_completed_at as Date | string | null);
  const nextDueDate = optional(row.next_due_date as string | null);
  const metadata = optional(row.metadata as Record<string, string> | null);
  if (estimatedMinutes != null) payload.estimatedMinutes = estimatedMinutes;
  if (schedule != null) payload.schedule = schedule;
  if (lastCompletedAt != null) payload.lastCompletedAt = iso(lastCompletedAt);
  if (nextDueDate != null) payload.nextDueDate = nextDueDate;
  if (metadata != null) payload.metadata = metadata;
  return payload;
}

function completionPayload(row: Record<string, unknown>): CompletionPayload {
  const payload: CompletionPayload = {
    taskId: row.task_id as string,
    completedAt: iso(row.completed_at as Date | string)
  };
  const profileId = optional(row.profile_id as string | null);
  if (profileId != null) payload.profileId = profileId;
  const scheduledFor = optional(row.scheduled_for as string | null);
  if (scheduledFor != null) payload.scheduledFor = scheduledFor;
  return payload;
}

export class SyncRepository {
  constructor(private readonly pool: pg.Pool) {}

  async ready(): Promise<void> {
    await this.pool.query("SELECT 1 FROM schema_migrations LIMIT 1");
  }

  async createHome(name: string): Promise<{ id: string; name: string; revision: string }> {
    const id = randomUUID();
    return withTransaction(this.pool, async (client) => {
      const revision = await this.nextRevision(client);
      const payload = { name } satisfies HomePayload;
      await client.query("INSERT INTO homes (id, name, revision) VALUES ($1, $2, $3)", [id, name, revision]);
      await this.recordChange(client, id, "home", id, "upsert", revision, payload);
      return { id, name, revision };
    });
  }

  async bootstrap(homeName: string, deviceName: string): Promise<PairingResult> {
    return withTransaction(this.pool, async (client) => {
      await client.query("LOCK TABLE homes IN EXCLUSIVE MODE");
      const existing = await client.query("SELECT 1 FROM homes LIMIT 1");
      if (existing.rowCount) throw new ApiError(409, "already_initialized", "This server has already been set up. Ask a paired device for a pairing code.");

      const homeId = randomUUID();
      const revision = await this.nextRevision(client);
      const payload = { name: homeName } satisfies HomePayload;
      await client.query("INSERT INTO homes (id, name, revision) VALUES ($1, $2, $3)", [homeId, homeName, revision]);
      await this.recordChange(client, homeId, "home", homeId, "upsert", revision, payload);

      const deviceId = randomUUID();
      const deviceToken = generateDeviceToken();
      await client.query(
        "INSERT INTO devices (id, home_id, name, token_hash) VALUES ($1, $2, $3, $4)",
        [deviceId, homeId, deviceName, hashDeviceToken(deviceToken)]
      );
      const snapshot = await this.snapshotWithClient(client, homeId);
      return { deviceToken, deviceId, homeId, snapshot };
    });
  }

  async enroll(homeName: string, deviceName: string): Promise<PairingResult> {
    return withTransaction(this.pool, async (client) => {
      await client.query("LOCK TABLE homes IN EXCLUSIVE MODE");
      const homes = await client.query<{ id: string }>("SELECT id FROM homes ORDER BY updated_at, id LIMIT 2");
      if (homes.rowCount && homes.rowCount > 1) throw new ApiError(409, "multiple_homes", "Open enrollment requires a single-home server.");

      let homeId = homes.rows[0]?.id;
      if (!homeId) {
        homeId = randomUUID();
        const revision = await this.nextRevision(client);
        const payload = { name: homeName } satisfies HomePayload;
        await client.query("INSERT INTO homes (id, name, revision) VALUES ($1, $2, $3)", [homeId, homeName, revision]);
        await this.recordChange(client, homeId, "home", homeId, "upsert", revision, payload);
      }

      const deviceId = randomUUID();
      const deviceToken = generateDeviceToken();
      await client.query(
        "INSERT INTO devices (id, home_id, name, token_hash) VALUES ($1, $2, $3, $4)",
        [deviceId, homeId, deviceName, hashDeviceToken(deviceToken)]
      );
      const snapshot = await this.snapshotWithClient(client, homeId);
      return { deviceToken, deviceId, homeId, snapshot };
    });
  }

  async issuePairingCode(homeId: string, validMinutes: number): Promise<{ code: string; expiresAt: string }> {
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + validMinutes * 60_000);
    await this.pool.query(
      `INSERT INTO pairing_codes (id, home_id, code_hash, expires_at)
       SELECT $1, id, $3, $4 FROM homes WHERE id = $2`,
      [randomUUID(), homeId, hashPairingCode(code), expiresAt]
    ).then((result) => {
      if (result.rowCount !== 1) throw new ApiError(404, "home_not_found", "The home does not exist.");
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async pair(code: string, deviceName: string): Promise<PairingResult> {
    return withTransaction(this.pool, async (client) => {
      const pairing = await client.query<{ id: string; home_id: string }>(
        `SELECT id, home_id FROM pairing_codes
         WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [hashPairingCode(code)]
      );
      const row = pairing.rows[0];
      if (!row) throw new ApiError(401, "invalid_pairing_code", "The pairing code is invalid or expired.");

      const deviceId = randomUUID();
      const deviceToken = generateDeviceToken();
      await client.query("UPDATE pairing_codes SET used_at = now() WHERE id = $1", [row.id]);
      await client.query(
        "INSERT INTO devices (id, home_id, name, token_hash) VALUES ($1, $2, $3, $4)",
        [deviceId, row.home_id, deviceName, hashDeviceToken(deviceToken)]
      );
      const snapshot = await this.snapshotWithClient(client, row.home_id);
      return { deviceToken, deviceId, homeId: row.home_id, snapshot };
    });
  }

  async authenticate(token: string): Promise<DeviceIdentity> {
    const result = await this.pool.query<{ id: string; home_id: string; name: string }>(
      `SELECT id, home_id, name FROM devices
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashDeviceToken(token)]
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(401, "invalid_token", "The device token is invalid or revoked.");
    return { id: row.id, homeId: row.home_id, name: row.name };
  }

  async snapshot(device: DeviceIdentity): Promise<SyncSnapshot> {
    return withTransaction(this.pool, async (client) => {
      await client.query("UPDATE devices SET last_seen_at = now() WHERE id = $1", [device.id]);
      return this.snapshotWithClient(client, device.homeId);
    });
  }

  async revoke(device: DeviceIdentity): Promise<void> {
    await this.pool.query("UPDATE devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [device.id]);
  }

  async sync(device: DeviceIdentity, request: SyncRequest): Promise<SyncResponse> {
    return withTransaction(this.pool, async (client) => {
      const maximumCursor = await this.maximumCursor(client, device.homeId);
      if (BigInt(request.cursor) > BigInt(maximumCursor)) {
        throw new ApiError(409, "cursor_ahead", "The client cursor is newer than this server's home history.");
      }

      const acknowledgements: MutationAcknowledgement[] = [];
      const conflicts: MutationConflict[] = [];
      const orderedMutations = [...request.mutations].sort((left, right) => mutationApplicationPriority(left) - mutationApplicationPriority(right));
      for (const mutation of orderedMutations) {
        const existing = await client.query<{ result: StoredMutationResult }>(
          "SELECT result FROM applied_mutations WHERE home_id = $1 AND mutation_id = $2",
          [device.homeId, mutation.id]
        );
        const stored = existing.rows[0]?.result;
        const result = stored ?? await this.applyMutation(client, device.homeId, mutation);
        if (!stored) {
          await client.query(
            "INSERT INTO applied_mutations (home_id, mutation_id, device_id, result) VALUES ($1, $2, $3, $4)",
            [device.homeId, mutation.id, device.id, result]
          );
        }
        if (result.kind === "acknowledgement") acknowledgements.push(result.value);
        else conflicts.push(result.value);
      }

      const changeResult = await client.query<{
        cursor: string;
        entity_type: EntityType;
        entity_id: string;
        operation: "upsert" | "delete";
        revision: string;
        payload: EntityPayload | null;
      }>(
        `SELECT cursor, entity_type, entity_id, operation, revision, payload
         FROM change_log WHERE home_id = $1 AND cursor > $2
         ORDER BY cursor ASC LIMIT $3`,
        [device.homeId, request.cursor, MAX_SYNC_CHANGES + 1]
      );
      const hasMore = changeResult.rows.length > MAX_SYNC_CHANGES;
      const rows = changeResult.rows.slice(0, MAX_SYNC_CHANGES);
      const changes: SyncChange[] = rows.map((row) => {
        const change: SyncChange = {
          cursor: row.cursor,
          entityType: row.entity_type,
          entityId: row.entity_id,
          operation: row.operation,
          revision: row.revision
        };
        if (row.payload != null) change.payload = row.payload;
        return change;
      });
      const cursor = changes.at(-1)?.cursor ?? request.cursor;
      await client.query("UPDATE devices SET last_seen_at = now() WHERE id = $1", [device.id]);
      return { protocolVersion: SYNC_PROTOCOL_VERSION, cursor, hasMore, acknowledgements, conflicts, changes };
    });
  }

  private async snapshotWithClient(client: pg.PoolClient, homeId: string): Promise<SyncSnapshot> {
    const [homeResult, profilesResult, roomsResult, tasksResult, completionsResult, cursor] = await Promise.all([
      client.query("SELECT * FROM homes WHERE id = $1", [homeId]),
      client.query("SELECT * FROM profiles WHERE home_id = $1 AND deleted_at IS NULL ORDER BY sort_order, id", [homeId]),
      client.query("SELECT * FROM rooms WHERE home_id = $1 AND deleted_at IS NULL ORDER BY sort_order, id", [homeId]),
      client.query("SELECT * FROM tasks WHERE home_id = $1 AND deleted_at IS NULL ORDER BY room_id, sort_order, id", [homeId]),
      client.query("SELECT * FROM completion_records WHERE home_id = $1 AND deleted_at IS NULL ORDER BY completed_at, id", [homeId]),
      this.maximumCursor(client, homeId)
    ]);
    const home = homeResult.rows[0] as Record<string, unknown> | undefined;
    if (!home) throw new ApiError(404, "home_not_found", "The paired home no longer exists.");
    return {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      cursor,
      home: { id: home.id as string, revision: home.revision as string, payload: homePayload(home) },
      profiles: profilesResult.rows.map((row: Record<string, unknown>) => ({ id: row.id as string, revision: row.revision as string, payload: profilePayload(row) })),
      rooms: roomsResult.rows.map((row: Record<string, unknown>) => ({ id: row.id as string, revision: row.revision as string, payload: roomPayload(row) })),
      tasks: tasksResult.rows.map((row: Record<string, unknown>) => ({ id: row.id as string, revision: row.revision as string, payload: taskPayload(row) })),
      completions: completionsResult.rows.map((row: Record<string, unknown>) => ({ id: row.id as string, revision: row.revision as string, payload: completionPayload(row) }))
    };
  }

  private async applyMutation(client: pg.PoolClient, homeId: string, mutation: SyncMutation): Promise<StoredMutationResult> {
    if (mutation.entityType === "home" && mutation.entityId !== homeId) {
      throw new ApiError(400, "invalid_home", "A home mutation must target the paired home.");
    }
    const current = await this.loadEntity(client, homeId, mutation.entityType, mutation.entityId);

    if (mutation.operation === "delete") {
      if (mutation.entityType === "home") return this.conflict(mutation, "home_cannot_be_deleted", current);
      if (!current) return this.acknowledgement(mutation, "0");
      if (current.deleted) return this.acknowledgement(mutation, current.revision);
      if (current.revision !== mutation.baseRevision) return this.conflict(mutation, "revision_mismatch", current);
      if (await this.hasActiveChildren(client, homeId, mutation.entityType, mutation.entityId)) {
        return this.conflict(mutation, "has_children", current);
      }
      const revision = await this.nextRevision(client);
      const table = this.table(mutation.entityType);
      await client.query(`UPDATE ${table} SET revision = $3, updated_at = now(), deleted_at = now() WHERE home_id = $1 AND id = $2`, [homeId, mutation.entityId, revision]);
      await this.recordChange(client, homeId, mutation.entityType, mutation.entityId, "delete", revision, null);
      return this.acknowledgement(mutation, revision);
    }

    if (current?.deleted && current.revision !== mutation.baseRevision) return this.conflict(mutation, "deleted", current);
    const expectedRevision = current?.revision ?? "0";
    if (expectedRevision !== mutation.baseRevision) return this.conflict(mutation, "revision_mismatch", current);
    if (!mutation.payload) throw new ApiError(400, "missing_payload", "An upsert requires a payload.");
    if (!await this.parentExists(client, homeId, mutation.entityType, mutation.payload)) {
      return this.conflict(mutation, "missing_parent", current);
    }
    if (!current && await this.exceedsEntityLimit(client, homeId, mutation.entityType)) {
      return this.conflict(mutation, "limit_exceeded", current);
    }

    const revision = await this.nextRevision(client);
    await this.upsertEntity(client, homeId, mutation.entityType, mutation.entityId, mutation.payload, revision);
    await this.recordChange(client, homeId, mutation.entityType, mutation.entityId, "upsert", revision, mutation.payload);
    return this.acknowledgement(mutation, revision);
  }

  private acknowledgement(mutation: SyncMutation, revision: string): StoredMutationResult {
    return {
      kind: "acknowledgement",
      value: { mutationId: mutation.id, entityType: mutation.entityType, entityId: mutation.entityId, revision }
    };
  }

  private conflict(mutation: SyncMutation, reason: MutationConflict["reason"], current?: StoredEntity): StoredMutationResult {
    const value: MutationConflict = {
      mutationId: mutation.id,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      reason,
      serverRevision: current?.revision ?? "0"
    };
    if (current?.payload && !current.deleted) value.serverPayload = current.payload;
    return { kind: "conflict", value };
  }

  private async loadEntity(client: pg.PoolClient, homeId: string, type: EntityType, id: string): Promise<StoredEntity | undefined> {
    if (type === "home") {
      const result = await client.query("SELECT * FROM homes WHERE id = $1 FOR UPDATE", [homeId]);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? { revision: row.revision as string, deleted: false, payload: homePayload(row) } : undefined;
    }
    const result = await client.query(`SELECT * FROM ${this.table(type)} WHERE home_id = $1 AND id = $2 FOR UPDATE`, [homeId, id]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const payload = type === "profile" ? profilePayload(row) : type === "room" ? roomPayload(row) : type === "task" ? taskPayload(row) : completionPayload(row);
    return { revision: row.revision as string, deleted: row.deleted_at != null, payload };
  }

  private async parentExists(client: pg.PoolClient, homeId: string, type: EntityType, payload: EntityPayload): Promise<boolean> {
    if (type === "task") {
      const result = await client.query("SELECT 1 FROM rooms WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL", [homeId, (payload as TaskPayload).roomId]);
      return result.rowCount === 1;
    }
    if (type === "completion") {
      const completion = payload as CompletionPayload;
      const task = await client.query("SELECT 1 FROM tasks WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL", [homeId, completion.taskId]);
      if (task.rowCount !== 1) return false;
      if (!completion.profileId) return true;
      const profile = await client.query("SELECT 1 FROM profiles WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL", [homeId, completion.profileId]);
      return profile.rowCount === 1;
    }
    return true;
  }

  private async hasActiveChildren(client: pg.PoolClient, homeId: string, type: EntityType, id: string): Promise<boolean> {
    if (type === "room") {
      const result = await client.query("SELECT 1 FROM tasks WHERE home_id = $1 AND room_id = $2 AND deleted_at IS NULL LIMIT 1", [homeId, id]);
      return result.rowCount === 1;
    }
    if (type === "task") {
      const result = await client.query("SELECT 1 FROM completion_records WHERE home_id = $1 AND task_id = $2 AND deleted_at IS NULL LIMIT 1", [homeId, id]);
      return result.rowCount === 1;
    }
    return false;
  }

  private async exceedsEntityLimit(client: pg.PoolClient, homeId: string, type: EntityType): Promise<boolean> {
    if (type !== "profile" && type !== "room" && type !== "task") return false;
    const table = this.table(type);
    const limit = type === "profile" ? 50 : type === "room" ? 250 : 10_000;
    const result = await client.query<{ count: string }>(`SELECT count(*)::bigint AS count FROM ${table} WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]);
    return BigInt(result.rows[0]?.count ?? "0") >= BigInt(limit);
  }

  private async upsertEntity(client: pg.PoolClient, homeId: string, type: EntityType, id: string, payload: EntityPayload, revision: string): Promise<void> {
    if (type === "home") {
      await client.query("UPDATE homes SET name = $2, revision = $3, updated_at = now() WHERE id = $1", [homeId, (payload as HomePayload).name, revision]);
      return;
    }
    if (type === "room") {
      const room = payload as RoomPayload;
      await client.query(
        `INSERT INTO rooms (home_id, id, name, notes, icon, sort_order, revision)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (home_id, id) DO UPDATE SET
           name = EXCLUDED.name, notes = EXCLUDED.notes, icon = EXCLUDED.icon,
           sort_order = EXCLUDED.sort_order, revision = EXCLUDED.revision, updated_at = now(), deleted_at = NULL`,
        [homeId, id, room.name, room.notes, room.icon, room.sortOrder, revision]
      );
      return;
    }
    if (type === "profile") {
      const profile = payload as ProfilePayload;
      await client.query(
        `INSERT INTO profiles (home_id, id, name, color, sort_order, revision)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (home_id, id) DO UPDATE SET
           name = EXCLUDED.name, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order,
           revision = EXCLUDED.revision, updated_at = now(), deleted_at = NULL`,
        [homeId, id, profile.name, profile.color, profile.sortOrder, revision]
      );
      return;
    }
    if (type === "task") {
      const task = payload as TaskPayload;
      await client.query(
        `INSERT INTO tasks (
           home_id, id, room_id, name, notes, estimated_minutes, sort_order, schedule,
           last_completed_at, next_due_date, reminder, metadata, created_at, revision
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (home_id, id) DO UPDATE SET
           room_id = EXCLUDED.room_id, name = EXCLUDED.name, notes = EXCLUDED.notes,
           estimated_minutes = EXCLUDED.estimated_minutes, sort_order = EXCLUDED.sort_order,
           schedule = EXCLUDED.schedule, last_completed_at = EXCLUDED.last_completed_at,
           next_due_date = EXCLUDED.next_due_date, reminder = EXCLUDED.reminder,
           metadata = EXCLUDED.metadata, revision = EXCLUDED.revision, updated_at = now(), deleted_at = NULL`,
        [homeId, id, task.roomId, task.name, task.notes, task.estimatedMinutes ?? null, task.sortOrder,
          task.schedule ?? null, task.lastCompletedAt ?? null, task.nextDueDate ?? null, task.reminder,
          task.metadata ?? null, task.createdAt, revision]
      );
      return;
    }
    const completion = payload as CompletionPayload;
    await client.query(
      `INSERT INTO completion_records (home_id, id, task_id, profile_id, completed_at, scheduled_for, revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (home_id, id) DO UPDATE SET
         task_id = EXCLUDED.task_id, profile_id = EXCLUDED.profile_id, completed_at = EXCLUDED.completed_at,
         scheduled_for = EXCLUDED.scheduled_for, revision = EXCLUDED.revision,
         updated_at = now(), deleted_at = NULL`,
      [homeId, id, completion.taskId, completion.profileId ?? null, completion.completedAt, completion.scheduledFor ?? null, revision]
    );
  }

  private table(type: Exclude<EntityType, "home">): string;
  private table(type: EntityType): string {
    if (type === "profile") return "profiles";
    if (type === "room") return "rooms";
    if (type === "task") return "tasks";
    if (type === "completion") return "completion_records";
    throw new Error("Home records do not use a scoped entity table.");
  }

  private async nextRevision(client: pg.PoolClient): Promise<string> {
    const result = await client.query<{ revision: string }>("SELECT nextval('sync_cursor_sequence') AS revision");
    const revision = result.rows[0]?.revision;
    if (!revision) throw new Error("Could not allocate a sync revision.");
    return revision;
  }

  private async maximumCursor(client: pg.PoolClient, homeId: string): Promise<string> {
    const result = await client.query<{ cursor: string }>("SELECT COALESCE(max(cursor), 0)::bigint AS cursor FROM change_log WHERE home_id = $1", [homeId]);
    return result.rows[0]?.cursor ?? "0";
  }

  private async recordChange(
    client: pg.PoolClient,
    homeId: string,
    entityType: EntityType,
    entityId: string,
    operation: "upsert" | "delete",
    revision: string,
    payload: EntityPayload | null
  ): Promise<void> {
    await client.query(
      `INSERT INTO change_log (cursor, home_id, entity_type, entity_id, operation, revision, payload)
       VALUES ($1, $2, $3, $4, $5, $1, $6)`,
      [revision, homeId, entityType, entityId, operation, payload]
    );
  }
}
