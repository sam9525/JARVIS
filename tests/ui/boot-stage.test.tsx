import { describe, it, expect } from "vitest";
import { nextStage, STEP_MS, FALLBACK_MS } from "../../src/renderer/ui/boot-stage";

describe("nextStage", () => {
  it("opens a stage when its signal is true", () => {
    expect(STEP_MS).toBe(120);
    expect(FALLBACK_MS).toBe(1200);
    expect(nextStage(-1, [true, false, false, false])).toBe(0);
  });

  it("opens every consecutive stage whose signal is already true", () => {
    expect(nextStage(-1, [true, true, true, true])).toBe(3);
  });

  it("cannot open a stage before the one above it", () => {
    expect(nextStage(-1, [false, true, true, true])).toBe(-1);
    expect(nextStage(0, [true, false, true, true])).toBe(0);
  });

  it("never decreases when a signal flips back to false", () => {
    expect(nextStage(2, [true, false, false, false])).toBe(2);
  });

  it("stops at the end of the list", () => {
    expect(nextStage(3, [true, true, true, true])).toBe(3);
  });
});
