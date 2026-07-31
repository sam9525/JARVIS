import { describe, it, expect } from "vitest";
import {
  GestureEngine,
  fingerExtended,
  type GestureEvent,
} from "../../src/renderer/hands/gestures";
import {
  fistHand,
  flickHand,
  palmHand,
  pinchedHand,
  shifted,
  twoFingerHand,
} from "./hands";

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
  it("emits drag on both axes while a pinch moves, then snap on release", () => {
    const g = new GestureEngine();
    g.update(pinchedHand(0.3), 0); // engage
    const dxs: number[] = [];
    const dys: number[] = [];
    for (let i = 1; i <= 5; i++) {
      for (const ev of g.update(
        shifted(pinchedHand(0.3), i * 0.1, i * 0.03),
        i / 30,
      ))
        if (ev.type === "drag") {
          dxs.push(ev.dx);
          dys.push(ev.dy);
        }
    }
    expect(dxs.length).toBeGreaterThan(0);
    expect(Math.max(...dxs)).toBeGreaterThan(0);
    expect(Math.max(...dys)).toBeGreaterThan(0);
    expect(types(g.update(palmHand(0.8), 6 / 30))).toContain("snap");
  });

  it("a pinch double-tap no longer emits open", () => {
    const g = new GestureEngine();
    g.update(palmHand(), 0);
    g.update(pinchedHand(), 1 / 30);
    g.update(palmHand(), 2 / 30);
    g.update(pinchedHand(), 4 / 30);
    const evs = g.update(palmHand(), 5 / 30);
    expect(types(evs)).toContain("snap");
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
  it("a fist held 1 s emits disarm exactly once", () => {
    const g = new GestureEngine();
    expect(types(g.update(fistHand(), 0))).not.toContain("disarm");
    expect(types(g.update(fistHand(), 0.5))).not.toContain("disarm");
    expect(types(g.update(fistHand(), 1.05))).toContain("disarm");
    expect(types(g.update(fistHand(), 1.1))).not.toContain("disarm");
  });

  it("breaking the fist resets the hold timer", () => {
    const g = new GestureEngine();
    g.update(fistHand(), 0);
    g.update(palmHand(), 0.5); // broken
    expect(types(g.update(fistHand(), 0.9))).not.toContain("disarm");
    expect(types(g.update(fistHand(), 1.5))).not.toContain("disarm"); // only 0.6 s held
    expect(types(g.update(fistHand(), 1.95))).toContain("disarm");
  });
});

describe("GestureEngine: palm arm", () => {
  it("a palm held 1 s emits arm exactly once", () => {
    const g = new GestureEngine();
    expect(types(g.update(palmHand(), 0))).not.toContain("arm");
    expect(types(g.update(palmHand(), 0.5))).not.toContain("arm");
    expect(types(g.update(palmHand(), 1.05))).toContain("arm");
    expect(types(g.update(palmHand(), 1.1))).not.toContain("arm");
  });

  it("breaking the palm resets the hold", () => {
    const g = new GestureEngine();
    g.update(palmHand(), 0);
    g.update(fistHand(), 0.5); // broken
    expect(types(g.update(palmHand(), 0.9))).not.toContain("arm");
    expect(types(g.update(palmHand(), 1.95))).toContain("arm"); // 1.05 s held
  });
});

describe("GestureEngine: forward tap", () => {
  const flick = (g: GestureEngine, t0: number) => {
    g.update(flickHand(), t0); // poke in — past TAP_Z_ENGAGE
    return g.update(twoFingerHand(), t0 + 1 / 30); // back out — past TAP_Z_RELEASE
  };

  it("one flick fires nothing; a second inside TAP_DOUBLE_S opens", () => {
    const g = new GestureEngine();
    g.update(twoFingerHand(), 0);
    expect(types(flick(g, 1 / 30))).not.toContain("open");
    expect(types(flick(g, 4 / 30))).toContain("open");
  });

  it("a second flick past the window does not open", () => {
    const g = new GestureEngine();
    g.update(twoFingerHand(), 0);
    flick(g, 1 / 30);
    expect(types(flick(g, 1.5))).not.toContain("open");
  });

  it("sub-threshold z noise fires nothing", () => {
    const g = new GestureEngine();
    const evs: GestureEvent[] = [];
    for (let i = 0; i < 10; i++)
      evs.push(...g.update(flickHand(0.5, i % 2 ? -0.03 : 0), i / 30)); // signal −0.15 > engage
    expect(types(evs)).not.toContain("open");
  });

  it("a horizontal two-finger swipe still steps and never opens", () => {
    const g = new GestureEngine();
    const evs: GestureEvent[] = [];
    for (let i = 0; i < 10; i++)
      evs.push(...g.update(twoFingerHand(0.1 + i * 0.08), i / 30));
    expect(types(evs)).toContain("step");
    expect(types(evs)).not.toContain("open");
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
