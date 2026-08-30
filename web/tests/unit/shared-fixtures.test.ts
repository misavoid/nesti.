import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextDueDate } from "../../src/core/dates";
import type { RecurrenceRule } from "../../src/core/types";

interface Fixture {
  name: string;
  rule: RecurrenceRule;
  reference: string;
  lastScheduled?: string;
  expected: string;
}

const fixtures = JSON.parse(readFileSync(new URL("../../../docs/fixtures/recurrence-v1.json", import.meta.url), "utf8")) as Fixture[];

describe("shared Swift and TypeScript recurrence fixtures", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      expect(nextDueDate(fixture.rule, fixture.reference, fixture.lastScheduled)).toBe(fixture.expected);
    });
  }
});
