import { describe, expect, it } from "vitest";
import { mutationApplicationPriority } from "../../src/core/sync";

describe("sync mutation ordering", () => {
  it("puts parent upserts first and child deletes first", () => {
    const values = [
      { entityType: "task", operation: "delete" },
      { entityType: "completion", operation: "upsert" },
      { entityType: "room", operation: "upsert" },
      { entityType: "completion", operation: "delete" },
      { entityType: "task", operation: "upsert" }
    ] as const;
    expect([...values].sort((left, right) => mutationApplicationPriority(left) - mutationApplicationPriority(right))).toEqual([
      { entityType: "room", operation: "upsert" },
      { entityType: "task", operation: "upsert" },
      { entityType: "completion", operation: "upsert" },
      { entityType: "completion", operation: "delete" },
      { entityType: "task", operation: "delete" }
    ]);
  });
});
