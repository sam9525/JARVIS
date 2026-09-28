import { describe, it, expect } from "vitest";
import { taskAge } from "../../src/renderer/todos/task-age";

const today = new Date(2026, 8, 28, 15, 30);

describe("taskAge", () => {
  it("counts whole local days, not hours", () => {
    expect(taskAge("2026-09-28", today)).toEqual({
      label: "today",
      tier: "fresh",
    });
    expect(taskAge("2026-09-27", today)).toEqual({
      label: "1d",
      tier: "fresh",
    });
    expect(taskAge("2026-09-25", today)).toEqual({ label: "3d", tier: "week" });
    expect(taskAge("2026-09-14", today)).toEqual({
      label: "14d",
      tier: "stale",
    });
  });

  it("crosses a month and a DST change without drifting", () => {
    expect(taskAge("2026-08-30", today)?.label).toBe("29d");
    expect(taskAge("2026-03-01", new Date(2026, 3, 1))?.label).toBe("31d");
  });

  it("reads a future date as today and a missing one as nothing", () => {
    expect(taskAge("2026-10-01", today)?.label).toBe("today");
    expect(taskAge(null, today)).toBeNull();
  });
});
