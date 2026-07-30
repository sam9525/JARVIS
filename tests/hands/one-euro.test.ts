import { describe, it, expect } from "vitest";
import {
  AnchorSmoother,
  OneEuroFilter,
} from "../../src/renderer/hands/one-euro";

describe("OneEuroFilter", () => {
  it("passes a constant signal through unchanged", () => {
    const f = new OneEuroFilter();
    let out = 0;
    for (let i = 0; i < 10; i++) out = f.filter(0.5, i / 30);
    expect(out).toBeCloseTo(0.5, 6);
  });

  it("moves toward a step change without overshooting", () => {
    const f = new OneEuroFilter();
    f.filter(0, 0);
    const out = f.filter(1, 1 / 30);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(1);
  });

  // the 1-Euro property: lag shrinks as speed grows (beta scales the cutoff)
  it("lags less on fast motion than on slow motion", () => {
    const lag = (step: number) => {
      const f = new OneEuroFilter(1, 1, 1);
      let x = 0;
      let out = 0;
      for (let i = 1; i <= 30; i++) {
        x += step;
        out = f.filter(x, i / 30);
      }
      return (x - out) / step; // lag measured in per-frame steps
    };
    expect(lag(0.05)).toBeLessThan(lag(0.001));
  });
});

describe("AnchorSmoother", () => {
  it("holds the committed value against sub-deadzone jitter", () => {
    const s = new AnchorSmoother();
    let held = 0;
    for (let i = 0; i < 30; i++) held = s.update(0.5, i / 30);
    expect(s.update(0.503, 31 / 30)).toBe(held);
    expect(s.update(0.497, 32 / 30)).toBe(held);
  });

  it("follows a move past the deadzone", () => {
    const s = new AnchorSmoother();
    for (let i = 0; i < 30; i++) s.update(0.5, i / 30);
    let out = 0.5;
    for (let i = 30; i < 60; i++) out = s.update(0.7, i / 30);
    expect(out).toBeGreaterThan(0.6);
  });
});
