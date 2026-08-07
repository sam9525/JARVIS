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

  it("collapses non-finite to rest — NaN reaching the camera freezes it", () => {
    expect(clampSpin(NaN)).toBe(0);
    expect(clampSpin(Infinity)).toBe(0);
    expect(clampSpin(-Infinity)).toBe(0);
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

  // Graph3D coasts by calling this with the total seconds since the throw, so
  // a starved rAF loop still comes to rest on time. Compounding a decay per
  // tick would measure the coast in frames instead, stretching it several-fold
  // at 10 fps.
  it("rest arrives at the same elapsed time however few samples land", () => {
    const restAfter = (fps: number) => {
      for (let n = 1; n <= fps * 30; n++) {
        const elapsed = n / fps;
        if (decaySpin(SPIN_MAX, elapsed) === 0) return elapsed;
      }
      return Infinity;
    };
    expect(restAfter(60)).toBeLessThan(4);
    // one sample every 200 ms resolves the same instant to within its step
    expect(Math.abs(restAfter(5) - restAfter(60))).toBeLessThan(0.2);
  });
});
