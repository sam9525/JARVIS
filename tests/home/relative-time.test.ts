import { describe, it, expect } from "vitest";
import { relativeTime } from "../../src/renderer/home/relative-time";

const S = 1000;
const M = 60 * S;
const H = 60 * M;

describe("relativeTime", () => {
  it("shows an em dash when there is no timestamp", () => {
    expect(relativeTime(0, 10 * H)).toBe("—");
  });

  it("shows 'just now' under five seconds", () => {
    expect(relativeTime(100 * S, 100 * S)).toBe("just now");
    expect(relativeTime(100 * S, 100 * S + 4 * S)).toBe("just now");
  });

  // `since` is a real ms epoch, so 0 is the "no timestamp" sentinel and can
  // never double as a time base — these count forward from an arbitrary one
  const T = 1_700_000_000_000;

  it("counts seconds, then minutes, then hours", () => {
    expect(relativeTime(T, T + 40 * S)).toBe("40s ago");
    expect(relativeTime(T, T + 5 * M)).toBe("5m ago");
    expect(relativeTime(T, T + 2 * H)).toBe("2h ago");
  });

  it("switches unit exactly at each boundary", () => {
    expect(relativeTime(T, T + 5 * S)).toBe("5s ago");
    expect(relativeTime(T, T + 59 * S)).toBe("59s ago");
    expect(relativeTime(T, T + 60 * S)).toBe("1m ago");
    expect(relativeTime(T, T + 59 * M)).toBe("59m ago");
    expect(relativeTime(T, T + 60 * M)).toBe("1h ago");
  });

  it("never shows a negative age when clocks disagree", () => {
    expect(relativeTime(10 * H, 1 * H)).toBe("just now");
  });
});
