import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeHttpServer, type SyncService } from "../../src/http.js";
import type { SyncSnapshot } from "../../src/protocol.js";

const homeId = "13a82f7a-2029-4e13-8a5d-40ea958dba88";
const deviceId = "c86c28e1-f104-49a0-b780-5daec591b794";
const snapshot: SyncSnapshot = {
  protocolVersion: 1,
  cursor: "1",
  home: { id: homeId, revision: "1", payload: { name: "Home" } },
  profiles: [],
  rooms: [],
  tasks: [],
  completions: []
};

const service: SyncService = {
  ready: vi.fn(async () => undefined),
  pair: vi.fn(async () => ({ deviceToken: "a".repeat(43), deviceId, homeId, snapshot })),
  authenticate: vi.fn(async () => ({ id: deviceId, homeId, name: "Test Device" })),
  snapshot: vi.fn(async () => snapshot),
  sync: vi.fn(async (_device, request) => ({
    protocolVersion: 1,
    cursor: request.cursor,
    hasMore: false,
    acknowledgements: [],
    conflicts: [],
    changes: []
  })),
  revoke: vi.fn(async () => undefined)
};

const server = makeHttpServer(service);
let origin = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("sync HTTP API", () => {
  it("publishes discovery without authentication", async () => {
    const response = await fetch(`${origin}/api/sync/v1/discovery`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ protocolVersions: [1], authenticationMethods: ["pairing_code"] });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects non-JSON pairing bodies", async () => {
    const response = await fetch(`${origin}/api/sync/v1/pair`, { method: "POST", body: "not-json" });
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "unsupported_media_type" } });
  });

  it("pairs a device and returns its initial snapshot", async () => {
    const response = await fetch(`${origin}/api/sync/v1/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD2345", deviceName: "Test Device" })
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ deviceId, homeId, snapshot: { cursor: "1" } });
  });

  it("requires a bearer token for snapshots", async () => {
    const missing = await fetch(`${origin}/api/sync/v1/snapshot`);
    expect(missing.status).toBe(401);
    const response = await fetch(`${origin}/api/sync/v1/snapshot`, { headers: { Authorization: `Bearer ${"a".repeat(43)}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ home: { id: homeId } });
  });
});
