import { describe, expect, it } from "vitest";
import {
  meterTone,
  resetIn,
} from "../../src/renderer/session-screen/status-format";

describe("meterTone", () => {
  it("switches at 50 and 80", () => {
    expect(meterTone(49)).toBe("accent");
    expect(meterTone(50)).toBe("warm");
    expect(meterTone(79)).toBe("warm");
    expect(meterTone(80)).toBe("hot");
  });
});

describe("resetIn", () => {
  const now = 1_000_000_000_000;
  const at = (sec: number) => now / 1000 + sec;
  it("formats days and hours", () => {
    expect(resetIn(at(2 * 86400 + 5 * 3600), now)).toBe("2d5h");
  });
  it("formats hours and minutes", () => {
    expect(resetIn(at(3 * 3600 + 12 * 60), now)).toBe("3h12m");
  });
  it("formats minutes", () => {
    expect(resetIn(at(45 * 60), now)).toBe("45m");
  });
  it("is empty once past", () => {
    expect(resetIn(at(-10), now)).toBe("");
  });
});
