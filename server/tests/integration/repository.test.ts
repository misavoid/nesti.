import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { SyncRepository } from "../../src/repository.js";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const pool = connectionString ? new pg.Pool({ connectionString, max: 4 }) : undefined;
const repository = pool ? new SyncRepository(pool) : undefined;
const homeIds: string[] = [];

afterAll(async () => {
  if (!pool) return;
  for (const homeId of homeIds) {
    await pool.query("DELETE FROM applied_mutations WHERE home_id = $1", [homeId]);
    await pool.query("DELETE FROM change_log WHERE home_id = $1", [homeId]);
    await pool.query("DELETE FROM pairing_codes WHERE home_id = $1", [homeId]);
    await pool.query("DELETE FROM devices WHERE home_id = $1", [homeId]);
    await pool.query("DELETE FROM completion_records WHERE home_id = $1", [homeId]);
    await pool.query("DELETE FROM tasks WHERE home_id = $1", [homeId]);
    await pool.query("DELETE FROM rooms WHERE home_id = $1", [homeId]);
    await pool.query("DELETE FROM homes WHERE id = $1", [homeId]);
  }
  await pool.end();
});

suite("PostgreSQL sync repository", () => {
  it("pairs devices, applies idempotent changes, reports conflicts, and revokes tokens", async () => {
    if (!repository) throw new Error("Repository unavailable.");
    const home = await repository.createHome("Integration Home");
    homeIds.push(home.id);

    const firstCode = await repository.issuePairingCode(home.id, 15);
    const first = await repository.pair(firstCode.code, "First Device");
    await expect(repository.pair(firstCode.code, "Reused Code")).rejects.toMatchObject({ code: "invalid_pairing_code" });

    const importedRoomID = crypto.randomUUID();
    const importedTaskID = crypto.randomUUID();
    const imported = await repository.sync(
      { id: first.deviceId, homeId: first.homeId, name: "First Device" },
      {
        protocolVersion: 1,
        cursor: first.snapshot.cursor,
        mutations: [
          {
            id: crypto.randomUUID(),
            entityType: "task",
            entityId: importedTaskID,
            operation: "upsert",
            baseRevision: "0",
            payload: { roomId: importedRoomID, name: "Imported task", notes: "", sortOrder: 0, reminder: { enabled: false, hour: 9, minute: 0 }, createdAt: "2026-08-30T12:00:00Z" }
          },
          {
            id: crypto.randomUUID(),
            entityType: "room",
            entityId: importedRoomID,
            operation: "upsert",
            baseRevision: "0",
            payload: { name: "Imported room", notes: "", icon: "door.left.hand.open", sortOrder: 0 }
          }
        ]
      }
    );
    expect(imported.conflicts).toHaveLength(0);
    expect(imported.acknowledgements.map((item) => item.entityType)).toEqual(["room", "task"]);

    const roomId = crypto.randomUUID();
    const mutationId = crypto.randomUUID();
    const createResponse = await repository.sync(
      { id: first.deviceId, homeId: first.homeId, name: "First Device" },
      {
        protocolVersion: 1,
        cursor: first.snapshot.cursor,
        mutations: [{
          id: mutationId,
          entityType: "room",
          entityId: roomId,
          operation: "upsert",
          baseRevision: "0",
          payload: { name: "Kitchen", notes: "", icon: "fork.knife", sortOrder: 0 }
        }]
      }
    );
    expect(createResponse.acknowledgements).toHaveLength(1);
    expect(createResponse.changes).toHaveLength(1);
    const roomRevision = createResponse.acknowledgements[0]?.revision;
    expect(roomRevision).toBeDefined();

    const retried = await repository.sync(
      { id: first.deviceId, homeId: first.homeId, name: "First Device" },
      {
        protocolVersion: 1,
        cursor: createResponse.cursor,
        mutations: [{
          id: mutationId,
          entityType: "room",
          entityId: roomId,
          operation: "upsert",
          baseRevision: "0",
          payload: { name: "Kitchen", notes: "", icon: "fork.knife", sortOrder: 0 }
        }]
      }
    );
    expect(retried.acknowledgements[0]?.revision).toBe(roomRevision);
    expect(retried.changes).toHaveLength(0);

    const secondCode = await repository.issuePairingCode(home.id, 15);
    const second = await repository.pair(secondCode.code, "Second Device");
    const firstUpdate = await repository.sync(
      { id: first.deviceId, homeId: first.homeId, name: "First Device" },
      {
        protocolVersion: 1,
        cursor: createResponse.cursor,
        mutations: [{
          id: crypto.randomUUID(),
          entityType: "room",
          entityId: roomId,
          operation: "upsert",
          baseRevision: roomRevision!,
          payload: { name: "Main Kitchen", notes: "", icon: "fork.knife", sortOrder: 0 }
        }]
      }
    );
    expect(firstUpdate.acknowledgements).toHaveLength(1);

    const staleUpdate = await repository.sync(
      { id: second.deviceId, homeId: second.homeId, name: "Second Device" },
      {
        protocolVersion: 1,
        cursor: second.snapshot.cursor,
        mutations: [{
          id: crypto.randomUUID(),
          entityType: "room",
          entityId: roomId,
          operation: "upsert",
          baseRevision: roomRevision!,
          payload: { name: "Other Kitchen", notes: "", icon: "fork.knife", sortOrder: 0 }
        }]
      }
    );
    expect(staleUpdate.conflicts[0]).toMatchObject({ reason: "revision_mismatch", serverPayload: { name: "Main Kitchen" } });

    const firstIdentity = await repository.authenticate(first.deviceToken);
    await repository.revoke(firstIdentity);
    await expect(repository.authenticate(first.deviceToken)).rejects.toMatchObject({ code: "invalid_token" });
  });
});
