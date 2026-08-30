import { describe, expect, it } from "vitest";
import { decodeDocument } from "../../src/core/codec";

const base = {
  version: 1,
  name: "My Home",
  rooms: [{
    name: "Bathroom",
    tasks: [{ name: "Clean shower", dueDate: "2026-09-01", schedule: { type: "interval", days: 7 } }]
  }]
};

describe(".nesti codec", () => {
  it("generates omitted identifiers and normalizes due-date aliases", () => {
    const document = decodeDocument(JSON.stringify(base));
    expect(document.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(document.rooms[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(document.rooms[0].tasks[0].nextDueDate).toBe("2026-09-01");
    expect(document.rooms[0].tasks[0].schedule).toEqual({ type: "interval", days: 7, basis: "completion" });
  });

  it("ignores unknown keys", () => {
    const document = decodeDocument(JSON.stringify({ ...base, futureField: { enabled: true } }));
    expect(document.name).toBe("My Home");
  });

  it("rejects unsupported versions", () => {
    expect(() => decodeDocument(JSON.stringify({ ...base, version: 2 }))).toThrow("unsupported format version 2");
  });

  it("rejects invalid recurrence rules before import", () => {
    const invalid = structuredClone(base);
    invalid.rooms[0].tasks[0].schedule.days = 0;
    expect(() => decodeDocument(JSON.stringify(invalid))).toThrow("between 1 and 3650");
  });
});
