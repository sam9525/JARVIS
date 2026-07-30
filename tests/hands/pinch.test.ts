import { describe, it, expect } from "vitest";
import {
  INDEX_TIP,
  MIDDLE_MCP,
  PinchDetector,
  THUMB_TIP,
  WRIST,
  normalizedPinchDistance,
  type Landmark,
} from "../../src/renderer/hands/pinch";

// a hand whose thumb–index separation is exactly `n` in normalized units
const handWithNorm = (n: number, scale = 0.2): Landmark[] => {
  const h: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  h[WRIST] = { x: 0.5, y: 0.8 };
  h[MIDDLE_MCP] = { x: 0.5, y: 0.8 - scale };
  h[THUMB_TIP] = { x: 0.3, y: 0.4 };
  h[INDEX_TIP] = { x: 0.3 + n * scale, y: 0.4 };
  return h;
};

describe("normalizedPinchDistance", () => {
  it("is invariant to hand scale (distance from camera)", () => {
    expect(normalizedPinchDistance(handWithNorm(0.3, 0.2))).toBeCloseTo(0.3, 6);
    expect(normalizedPinchDistance(handWithNorm(0.3, 0.4))).toBeCloseTo(0.3, 6);
  });

  it("returns Infinity for a degenerate zero-scale hand", () => {
    expect(normalizedPinchDistance(handWithNorm(0.3, 0))).toBe(Infinity);
  });
});

describe("PinchDetector", () => {
  it("engages below 0.35, not in the hysteresis band", () => {
    const d = new PinchDetector();
    expect(d.update(handWithNorm(0.4), 0).isPinching).toBe(false);
    const s = d.update(handWithNorm(0.3), 1 / 30);
    expect(s.isPinching).toBe(true);
    expect(s.justEngaged).toBe(true);
  });

  it("holds through the band and releases only past 0.45", () => {
    const d = new PinchDetector();
    d.update(handWithNorm(0.1), 0);
    expect(d.update(handWithNorm(0.4), 0.1).isPinching).toBe(true);
    const s = d.update(handWithNorm(0.5), 0.2);
    expect(s.isPinching).toBe(false);
    expect(s.justReleased).toBe(true);
  });

  it("blocks re-engage inside the re-arm window, allows it after", () => {
    const d = new PinchDetector();
    d.update(handWithNorm(0.1), 0); // engage at t=0
    d.update(handWithNorm(0.5), 0.02); // release
    expect(d.update(handWithNorm(0.1), 0.05).isPinching).toBe(false); // 0.05 < 0.08
    const s = d.update(handWithNorm(0.1), 0.09); // 0.09 ≥ 0.08 from engage
    expect(s.isPinching).toBe(true);
    expect(s.justEngaged).toBe(true);
  });
});
