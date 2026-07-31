import { describe, it, expect } from "vitest";
import {
  knuckleAngle,
  RollTracker,
  unwrap,
  ROLL_MAX_RAD_S,
} from "../../src/renderer/hands/roll";
import { palmHand, rolledPalmHand } from "./hands";

describe("unwrap", () => {
  it("crosses the +π seam without a 2π jump", () => {
    expect(unwrap(3.1, -3.1)).toBeCloseTo(3.1 + (2 * Math.PI - 6.2), 6);
  });
  it("crosses the −π seam without a 2π jump", () => {
    expect(unwrap(-3.1, 3.1)).toBeCloseTo(-3.1 - (2 * Math.PI - 6.2), 6);
  });
  it("leaves small steps alone", () => {
    expect(unwrap(0.5, 0.6)).toBeCloseTo(0.6, 9);
  });
});

describe("knuckleAngle", () => {
  it("reads the fixture's knuckle line and guards the degenerate hand", () => {
    expect(knuckleAngle(rolledPalmHand(0.4))).toBeCloseTo(0.4, 6);
    expect(knuckleAngle(palmHand())).toBeNull(); // MCPs coincide in the base fixture
  });
});

describe("RollTracker", () => {
  const feed = (angles: number[], dt = 1 / 30) => {
    const r = new RollTracker();
    return angles.map((a, i) => r.update(a, i * dt));
  };

  it("a still line is silent", () => {
    expect(feed([0.2, 0.2, 0.2, 0.2])).toEqual([0, 0, 0, 0]);
  });

  it("a drift below ROLL_MIN_RAD_S is silent (dead zone)", () => {
    // 0.005 rad/frame at 30 fps = 0.15 rad/s < 0.8
    const out = feed(Array.from({ length: 10 }, (_, i) => i * 0.005));
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it("a spin crossing the ±π seam keeps its sign", () => {
    // +0.1 rad/frame = 3 rad/s, straight across +π
    const angles = Array.from({ length: 12 }, (_, i) => {
      const a = 2.9 + i * 0.1;
      return a > Math.PI ? a - 2 * Math.PI : a;
    });
    const out = feed(angles);
    expect(out.some((v) => v > 0)).toBe(true);
    expect(out.every((v) => v >= 0)).toBe(true); // never a giant negative jump
  });

  it("clamps a hard flick to ROLL_MAX_RAD_S", () => {
    const out = feed(Array.from({ length: 10 }, (_, i) => i * 1.0)); // 30 rad/s
    expect(Math.max(...out)).toBe(ROLL_MAX_RAD_S);
    expect(out.every((v) => v <= ROLL_MAX_RAD_S)).toBe(true);
  });
});
