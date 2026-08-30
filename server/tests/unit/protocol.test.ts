import { describe, expect, it } from "vitest";
import { parseBootstrapRequest, parsePairRequest, parseSyncRequest, ProtocolError } from "../../src/protocol.js";

const taskPayload = {
  roomId: "13a82f7a-2029-4e13-8a5d-40ea958dba88",
  name: "Clean sink",
  notes: "",
  sortOrder: 0,
  schedule: { type: "interval", days: 7 },
  nextDueDate: "2026-09-01",
  reminder: { enabled: false, hour: 9, minute: 0 },
  createdAt: "2026-08-30T12:00:00Z"
};

describe("sync protocol validation", () => {
  it("normalizes a task upsert", () => {
    const request = parseSyncRequest({
      protocolVersion: 1,
      cursor: "0",
      mutations: [{
        id: "87AD8DC0-00A0-4D9E-9A6F-BB19D5F88D15",
        entityType: "task",
        entityId: "C86C28E1-F104-49A0-B780-5DAEC591B794",
        operation: "upsert",
        baseRevision: "0",
        payload: taskPayload
      }]
    });

    expect(request.mutations[0]?.id).toBe("87ad8dc0-00a0-4d9e-9a6f-bb19d5f88d15");
    expect(request.mutations[0]?.payload).toMatchObject({
      schedule: { type: "interval", days: 7, basis: "completion" },
      nextDueDate: "2026-09-01"
    });
  });

  it("rejects duplicate mutation identifiers", () => {
    const mutation = {
      id: "87ad8dc0-00a0-4d9e-9a6f-bb19d5f88d15",
      entityType: "home",
      entityId: "c86c28e1-f104-49a0-b780-5daec591b794",
      operation: "upsert",
      baseRevision: "1",
      payload: { name: "Home" }
    };
    expect(() => parseSyncRequest({ protocolVersion: 1, cursor: "0", mutations: [mutation, mutation] })).toThrow("unique");
  });

  it("rejects unsupported protocol versions", () => {
    try {
      parseSyncRequest({ protocolVersion: 2, cursor: "0", mutations: [] });
      throw new Error("Expected validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).code).toBe("unsupported_protocol");
    }
  });

  it("normalizes human-formatted pairing codes", () => {
    expect(parsePairRequest({ code: "abcd-2345", deviceName: " Alice's iPhone " })).toEqual({
      code: "ABCD2345",
      deviceName: "Alice's iPhone"
    });
  });

  it("validates first-run setup names", () => {
    expect(parseBootstrapRequest({ homeName: " My Home ", deviceName: " Browser " })).toEqual({ homeName: "My Home", deviceName: "Browser" });
    expect(() => parseBootstrapRequest({ homeName: "", deviceName: "Browser" })).toThrow(ProtocolError);
  });

  it("accepts profiles and profile-attributed completions", () => {
    const profileId = "13a82f7a-2029-4e13-8a5d-40ea958dba88";
    const request = parseSyncRequest({
      protocolVersion: 1,
      cursor: "0",
      mutations: [
        { id: crypto.randomUUID(), entityType: "profile", entityId: profileId, operation: "upsert", baseRevision: "0", payload: { name: "Alex", color: "#147d64", sortOrder: 0 } },
        { id: crypto.randomUUID(), entityType: "completion", entityId: crypto.randomUUID(), operation: "upsert", baseRevision: "0", payload: { taskId: crypto.randomUUID(), profileId, completedAt: "2026-08-30T12:00:00Z" } }
      ]
    });
    expect(request.mutations[0]?.payload).toEqual({ name: "Alex", color: "#147d64", sortOrder: 0 });
    expect(request.mutations[1]?.payload).toMatchObject({ profileId });
  });
});
