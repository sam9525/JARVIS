import { describe, it, expect } from "vitest";
import {
  clampSpin,
  decaySpin,
  SPIN_MAX,
  SPIN_REST,
} from "../../src/renderer/graph/spin";

describe("spin", () => {
  it("clamps to ±SPIN_MAX", () => {
    expect(clampSpin(1e6)).toBe(SPIN_MAX);
    expect(clampSpin(-1e6)).toBe(-SPIN_MAX);
    expect(clampSpin(3)).toBe(3);
  });

  it("decay preserves sign and shrinks magnitude", () => {
    expect(decaySpin(10, 0.1)).toBeGreaterThan(0);
    expect(decaySpin(10, 0.1)).toBeLessThan(10);
    expect(decaySpin(-10, 0.1)).toBeLessThan(0);
    expect(decaySpin(-10, 0.1)).toBeGreaterThan(-10);
  });

  it("reaches rest (exactly 0) in bounded time", () => {
    let v = SPIN_MAX;
    let steps = 0;
    while (v !== 0 && steps < 1000) {
      v = decaySpin(v, 1 / 60);
      steps++;
    }
    expect(v).toBe(0);
    expect(steps).toBeLessThan(600); // < 10 s of frames
  });

  it("a value below SPIN_REST snaps straight to 0", () => {
    expect(decaySpin(SPIN_REST / 2, 1 / 60)).toBe(0);
  });
});
