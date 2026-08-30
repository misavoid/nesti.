import { describe, expect, it } from "vitest";
import { initialDueDate, nextDueDate } from "../../src/core/dates";

describe("recurrence parity", () => {
  it("advances completion intervals from the completion day", () => {
    expect(nextDueDate({ type: "interval", days: 7, basis: "completion" }, "2026-08-30")).toBe("2026-09-06");
  });

  it("skips missed scheduled intervals", () => {
    expect(nextDueDate({ type: "interval", days: 4, basis: "scheduled" }, "2026-08-30", "2026-08-20")).toBe("2026-09-01");
  });

  it("finds the next selected weekday", () => {
    expect(nextDueDate({ type: "weekdays", days: ["monday", "thursday"] }, "2026-08-30")).toBe("2026-08-31");
  });

  it("clamps monthly recurrence to the final day", () => {
    expect(nextDueDate({ type: "monthly", intervalMonths: 1, basis: "completion" }, "2024-01-31")).toBe("2024-02-29");
    expect(nextDueDate({ type: "monthly", day: 31, intervalMonths: 1, basis: "scheduled" }, "2026-02-28")).toBe("2026-03-31");
  });

  it("uses today when it is an eligible initial weekday", () => {
    expect(initialDueDate({ type: "weekdays", days: ["sunday"] }, "2026-08-30")).toBe("2026-08-30");
  });
});
