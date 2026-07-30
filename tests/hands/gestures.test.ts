import { describe, it, expect } from "vitest";
import {
  GestureEngine,
  fingerExtended,
  type GestureEvent,
} from "../../src/renderer/hands/gestures";
import { fistHand, palmHand, pinchedHand, twoFingerHand } from "./hands";

const types = (evs: GestureEvent[]) => evs.map((e) => e.type);

describe("fingerExtended", () => {
  it("reads tip-beyond-PIP as extended, tip-inside as curled", () => {
    expect(fingerExtended(palmHand(), "index")).toBe(true);
    expect(fingerExtended(palmHand(), "pinky")).toBe(true);
    expect(fingerExtended(fistHand(), "index")).toBe(false);
    expect(fingerExtended(twoFingerHand(), "middle")).toBe(true);
    expect(fingerExtended(twoFingerHand(), "ring")).toBe(false);
  });
});

describe("GestureEngine: pinch drag", () => {
  it("emits rotate while a pinch moves, then snap on release", () => {
    const g = new GestureEngine();
    g.update(pinchedHand(0.3), 0); // engage
    const rotates: number[] = [];
    for (let i = 1; i <= 5; i++) {
      for (const ev of g.update(pinchedHand(0.3 + i * 0.1), i / 30))
        if (ev.type === "rotate") rotates.push(ev.dx);
    }
    expect(rotates.length).toBeGreaterThan(0);
    expect(Math.max(...rotates)).toBeGreaterThan(0);
    expect(types(g.update(palmHand(0.8), 6 / 30))).toContain("snap");
  });

  it("a moved pinch is a drag: its release never counts toward a double-tap", () => {
    const g = new GestureEngine();
    g.update(pinchedHand(0.3), 0);
    for (let i = 1; i <= 5; i++) g.update(pinchedHand(0.3 + i * 0.1), i / 30);
    g.update(palmHand(0.8), 6 / 30); // release a drag
    // quick clean tap right after — must NOT open (previous release was a drag)
    g.update(pinchedHand(0.8), 9 / 30);
    const evs = g.update(palmHand(0.8), 10 / 30);
    expect(types(evs)).toContain("snap");
    expect(types(evs)).not.toContain("open");
  });
});

describe("GestureEngine: double-tap", () => {
  const tap = (g: GestureEngine, tEngage: number, tRelease: number) => {
    g.update(pinchedHand(), tEngage);
    return g.update(palmHand(), tRelease);
  };

  it("two stationary taps within 0.4 s open", () => {
    const g = new GestureEngine();
    g.update(palmHand(), 0);
    expect(types(tap(g, 1 / 30, 2 / 30))).not.toContain("open");
    // second engage at 0.133 s clears the 0.08 s re-arm from the first
    const evs = tap(g, 4 / 30, 5 / 30);
    expect(types(evs)).toContain("open");
  });

  it("a second tap past the 0.4 s window does not open", () => {
    const g = new GestureEngine();
    g.update(palmHand(), 0);
    tap(g, 1 / 30, 2 / 30); // release at ~0.067
    const evs = tap(g, 0.5, 0.55); // release 0.483 s after the first
    expect(types(evs)).not.toContain("open");
  });
});

describe("GestureEngine: two-finger step", () => {
  it("a rightward swipe emits step dir 1", () => {
    const g = new GestureEngine();
    const dirs: number[] = [];
    for (let i = 0; i < 10; i++) {
      for (const ev of g.update(twoFingerHand(0.1 + i * 0.1), i / 30))
        if (ev.type === "step") dirs.push(ev.dir);
    }
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs[0]).toBe(1);
  });

  it("a leftward swipe emits step dir -1", () => {
    const g = new GestureEngine();
    const dirs: number[] = [];
    for (let i = 0; i < 10; i++) {
      for (const ev of g.update(twoFingerHand(0.9 - i * 0.1), i / 30))
        if (ev.type === "step") dirs.push(ev.dir);
    }
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs[0]).toBe(-1);
  });
});

describe("GestureEngine: fist off", () => {
  it("a fist held 1 s emits off exactly once", () => {
    const g = new GestureEngine();
    expect(types(g.update(fistHand(), 0))).not.toContain("off");
    expect(types(g.update(fistHand(), 0.5))).not.toContain("off");
    expect(types(g.update(fistHand(), 1.05))).toContain("off");
    expect(types(g.update(fistHand(), 1.1))).not.toContain("off");
  });

  it("breaking the fist resets the hold timer", () => {
    const g = new GestureEngine();
    g.update(fistHand(), 0);
    g.update(palmHand(), 0.5); // broken
    expect(types(g.update(fistHand(), 0.9))).not.toContain("off");
    expect(types(g.update(fistHand(), 1.5))).not.toContain("off"); // only 0.6 s held
    expect(types(g.update(fistHand(), 1.95))).toContain("off");
  });
});

describe("GestureEngine: hand loss", () => {
  it("losing the hand mid-pinch snaps and resets cleanly", () => {
    const g = new GestureEngine();
    g.update(pinchedHand(0.3), 0);
    expect(types(g.update(null, 1 / 30))).toContain("snap");
    expect(g.update(null, 2 / 30)).toEqual([]);
  });
});
