import { describe, it, expect } from "vitest";
import {
  GestureEngine,
  fingerExtended,
  ZOOM_MAX_RATE,
  type GestureEvent,
} from "../../src/renderer/hands/gestures";
import { ROLL_MAX_RAD_S } from "../../src/renderer/hands/roll";
import {
  fistHand,
  palmHand,
  pinchedHand,
  pinchingTapHand,
  rolledPalmHand,
  rolledScaledPalm,
  scaledPalmHand,
  shifted,
  strayFingerHand,
  tapHand,
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

  // pins the negative result: the posture gate was the prime suspect for
  // "rotate is hard to hold", and it is not guilty — a whole-hand roll leaves
  // every wrist distance untouched. Keep this so the suspicion stays retired.
  it("survives a full roll of the hand in both directions", () => {
    for (let a = -Math.PI; a <= Math.PI; a += Math.PI / 12) {
      const rolled = rolledPalmHand(a);
      for (const f of ["index", "middle", "ring", "pinky"] as const)
        expect(fingerExtended(rolled, f), `${f} at ${a.toFixed(2)} rad`).toBe(
          true,
        );
    }
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

  // the two reasons the row never fired on a real camera
  it("a stray extended ring finger still reads as the two-finger posture", () => {
    const g = new GestureEngine();
    const dirs: number[] = [];
    for (let i = 0; i < 10; i++) {
      for (const ev of g.update(strayFingerHand(0.1 + i * 0.1), i / 30))
        if (ev.type === "step") dirs.push(ev.dir);
    }
    expect(dirs.length).toBeGreaterThan(0);
  });

  it("a one-frame posture dropout does not reset the swipe", () => {
    const g = new GestureEngine();
    const dirs: number[] = [];
    for (let i = 0; i < 10; i++) {
      // every third frame the posture reads as a fist — MediaPipe noise
      const h =
        i % 3 === 2 ? fistHand(0.1 + i * 0.1) : twoFingerHand(0.1 + i * 0.1);
      for (const ev of g.update(h, i / 30))
        if (ev.type === "step") dirs.push(ev.dir);
    }
    expect(dirs.length).toBeGreaterThan(0);
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

describe("GestureEngine: two-finger tap", () => {
  const tap = (g: GestureEngine, t0: number) => {
    g.update(tapHand(), t0); // bent — past TAP_BEND_ENGAGE
    return g.update(twoFingerHand(), t0 + 1 / 30); // straight — past TAP_BEND_RELEASE
  };

  it("one tap fires nothing; a second inside TAP_DOUBLE_S opens", () => {
    const g = new GestureEngine();
    g.update(twoFingerHand(), 0);
    expect(types(tap(g, 1 / 30))).not.toContain("open");
    expect(types(tap(g, 4 / 30))).toContain("open");
  });

  it("a second tap past the window does not open", () => {
    const g = new GestureEngine();
    g.update(twoFingerHand(), 0);
    tap(g, 1 / 30);
    expect(types(tap(g, 1.5))).not.toContain("open");
  });

  it("a finger wobble short of the bend threshold fires nothing", () => {
    const g = new GestureEngine();
    const evs: GestureEvent[] = [];
    for (let i = 0; i < 10; i++)
      evs.push(...g.update(tapHand(0.5, i % 2 ? 0.95 : 1), i / 30)); // dips to 0.95 of straight, engage is 0.88
    expect(types(evs)).not.toContain("open");
  });

  // the reason the row never fired on a real hand: bending the fingers puts
  // the index tip on the thumb, so the tap arrived as a pinch
  it("a tap the pinch detector also sees still opens, and does not snap", () => {
    const g = new GestureEngine();
    g.update(twoFingerHand(), 0);
    const evs: GestureEvent[] = [];
    for (const t0 of [1 / 30, 4 / 30]) {
      evs.push(...g.update(pinchingTapHand(), t0));
      evs.push(...g.update(twoFingerHand(), t0 + 1 / 30));
    }
    expect(types(evs)).toContain("open");
    expect(types(evs)).not.toContain("snap");
  });

  // straightening alone must not count: a hand at rest sits slightly curled,
  // and that used to leave the row engaged with nothing but an extension
  // needed to fire it
  it("a slow curl and straighten is a posture, not a tap", () => {
    const g = new GestureEngine();
    g.update(twoFingerHand(), 0);
    const evs: GestureEvent[] = [];
    for (const t0 of [0.1, 1.6]) {
      evs.push(...g.update(tapHand(), t0)); // bent...
      evs.push(...g.update(tapHand(), t0 + 0.9)); // ...and held
      evs.push(...g.update(twoFingerHand(), t0 + 1.0));
    }
    expect(types(evs)).not.toContain("open");
  });

  it("a long hold banks nothing, so the tap after it cannot open alone", () => {
    const g = new GestureEngine();
    g.update(twoFingerHand(), 0);
    const evs: GestureEvent[] = [];
    for (let i = 1; i < 600; i++) evs.push(...g.update(tapHand(), i / 30)); // 20 s bent
    evs.push(...g.update(twoFingerHand(), 20.1)); // straighten — discarded
    evs.push(...g.update(tapHand(), 20.2)); // one real tap...
    evs.push(...g.update(twoFingerHand(), 20.3)); // ...is still only one
    expect(types(evs)).not.toContain("open");
  });

  it("a tap does not step, however far the hand drifts while tapping", () => {
    const g = new GestureEngine();
    const evs: GestureEvent[] = [];
    let x = 0.3;
    g.update(twoFingerHand(x), 0);
    // 0.06 of sideways drift per frame — 0.24 over the pair, 2x SWIPE_STEP
    for (const t0 of [1 / 30, 4 / 30]) {
      x += 0.06;
      evs.push(...g.update(tapHand(x), t0));
      x += 0.06;
      evs.push(...g.update(twoFingerHand(x), t0 + 1 / 30));
    }
    expect(types(evs)).toContain("open");
    expect(types(evs)).not.toContain("step");
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

describe("GestureEngine: palm camera", () => {
  it("orbit follows the twist's direction; a still palm is silent", () => {
    const g = new GestureEngine();
    const vs: number[] = [];
    for (let i = 0; i < 8; i++)
      for (const ev of g.update(rolledPalmHand(i * 0.15), i / 30))
        if (ev.type === "orbit") vs.push(ev.v);
    expect(vs.length).toBeGreaterThan(0);
    expect(vs.every((v) => v > 0)).toBe(true);

    const back = new GestureEngine();
    const neg: number[] = [];
    for (let i = 0; i < 8; i++)
      for (const ev of back.update(rolledPalmHand(-i * 0.15), i / 30))
        if (ev.type === "orbit") neg.push(ev.v);
    expect(neg.every((v) => v < 0)).toBe(true);

    const still = new GestureEngine();
    for (let i = 0; i < 8; i++)
      expect(types(still.update(rolledPalmHand(0.3), i / 30))).not.toContain(
        "orbit",
      );
  });

  it("clamps a hard flick to ROLL_MAX_RAD_S", () => {
    const g = new GestureEngine();
    const vs: number[] = [];
    for (let i = 0; i < 8; i++)
      for (const ev of g.update(rolledPalmHand(i * 1.0), i / 30))
        if (ev.type === "orbit") vs.push(ev.v);
    expect(vs.length).toBeGreaterThan(0);
    expect(vs.every((v) => v <= ROLL_MAX_RAD_S)).toBe(true);
  });

  it("push zooms in, pull zooms out, still emits nothing", () => {
    const push = new GestureEngine();
    const fs: number[] = [];
    for (let i = 0; i < 8; i++)
      for (const ev of push.update(scaledPalmHand(0.2 + i * 0.02), i / 30))
        if (ev.type === "zoom") fs.push(ev.factor);
    expect(fs.length).toBeGreaterThan(0);
    expect(fs.every((f) => f > 1 && f <= ZOOM_MAX_RATE)).toBe(true);

    const pull = new GestureEngine();
    const gs: number[] = [];
    for (let i = 0; i < 8; i++)
      for (const ev of pull.update(scaledPalmHand(0.28 - i * 0.02), i / 30))
        if (ev.type === "zoom") gs.push(ev.factor);
    expect(gs.length).toBeGreaterThan(0);
    expect(gs.every((f) => f < 1 && f >= 1 / ZOOM_MAX_RATE)).toBe(true);

    const still = new GestureEngine();
    for (let i = 0; i < 8; i++)
      expect(types(still.update(scaledPalmHand(0.25), i / 30))).not.toContain(
        "zoom",
      );
  });

  // there is no axis lock: orbit won every race in practice (its signal is a
  // derivative, so tremor crossed the dead zone first) and zoom was
  // unreachable. Each dead zone guards its own axis instead.
  it("roll and push on one frame emit both, and zoom stays reachable after a roll", () => {
    const g = new GestureEngine();
    g.update(rolledScaledPalm(0, 0.2), 0); // baseline
    const evs = g.update(rolledScaledPalm(0.5, 0.3), 1 / 30);
    expect(types(evs)).toContain("orbit");
    expect(types(evs)).toContain("zoom");
    // zoom-only motion right after a roll still reaches the camera — this is
    // the case the lock used to swallow for the rest of the posture
    expect(types(g.update(rolledScaledPalm(0.5, 0.35), 2 / 30))).toContain(
      "zoom",
    );
  });

  it("a two-finger swipe emits neither orbit nor zoom (the palm gate)", () => {
    const g = new GestureEngine();
    const evs: GestureEvent[] = [];
    for (let i = 0; i < 10; i++)
      evs.push(...g.update(twoFingerHand(0.1 + i * 0.08), i / 30));
    expect(types(evs)).toContain("step");
    expect(types(evs)).not.toContain("orbit");
    expect(types(evs)).not.toContain("zoom");
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
