import { describe, it, expect } from "vitest";
import {
  GestureEngine,
  fingerExtended,
  ZOOM_MAX_RATE,
  type GestureEvent,
} from "../../src/renderer/hands/gestures";
import { ROLL_MAX_RAD_S } from "../../src/renderer/hands/roll";
import {
  fingerSwipeHand,
  fistHand,
  palmHand,
  pinchedHand,
  pinchingTapHand,
  rolledPalmHand,
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

  it("swinging just the fingers steps — the wrist need not move", () => {
    const g = new GestureEngine();
    const dirs: number[] = [];
    const wrists = new Set<number>();
    for (let i = 0; i < 8; i++) {
      const h = fingerSwipeHand(-0.1 + i * 0.03);
      wrists.add(h[0].x);
      for (const ev of g.update(h, i / 30))
        if (ev.type === "step") dirs.push(ev.dir);
    }
    expect(wrists.size).toBe(1); // the wrist really did hold still
    expect(dirs).toEqual([1]);
  });

  // a swipe is speed, not banked distance: these three are what the
  // accumulator could not tell apart
  it("a slow drift never steps, however far the hand travels", () => {
    const g = new GestureEngine();
    const evs: GestureEvent[] = [];
    // 0.01 per frame = 0.3/s, under SWIPE_SPEED — but 0.6 of travel in total
    for (let i = 0; i < 60; i++)
      evs.push(...g.update(twoFingerHand(0.2 + i * 0.01), i / 30));
    expect(types(evs)).not.toContain("step");
  });

  it("one long sweep is one step, not one per fixed distance", () => {
    const g = new GestureEngine();
    const dirs: number[] = [];
    // 0.05 per frame over 8 frames — 0.4 of travel, four steps under the old
    // SWIPE_STEP of 0.1
    for (let i = 0; i < 8; i++)
      for (const ev of g.update(twoFingerHand(0.2 + i * 0.05), i / 30))
        if (ev.type === "step") dirs.push(ev.dir);
    expect(dirs).toEqual([1]);
  });

  it("the hand coming back does not step the other way", () => {
    const g = new GestureEngine();
    const dirs: number[] = [];
    const at = (x: number, t: number) => {
      for (const ev of g.update(twoFingerHand(x), t))
        if (ev.type === "step") dirs.push(ev.dir);
    };
    for (let i = 0; i < 6; i++) at(0.3 + i * 0.05, i / 30); // swipe right
    for (let i = 0; i < 6; i++) at(0.55 - i * 0.05, (6 + i) / 30); // and back
    expect(dirs).toEqual([1]);
  });

  it("a one-frame posture dropout does not stop the swipe", () => {
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
    // 0.03 of drift per frame — ~0.7/s, over SWIPE_SPEED so the step row would
    // fire, under TAP_STILL_SPEED so the tap still counts as one
    for (const t0 of [1 / 30, 4 / 30]) {
      x += 0.03;
      evs.push(...g.update(tapHand(x), t0));
      x += 0.03;
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

describe("GestureEngine: an abandoned bend", () => {
  // a clean two-finger swipe: tips sweep 0.06 of frame width per frame
  const swipe = (g: GestureEngine, t0: number): string[] => {
    const seen: string[] = [];
    for (let i = 0; i < 10; i++)
      seen.push(...types(g.update(fingerSwipeHand(i * 0.06), t0 + i / 30)));
    return seen;
  };

  it("does not block stepping once it is older than a tap can be", () => {
    const g = new GestureEngine();
    g.update(twoFingerHand(), 0);
    g.update(tapHand(), 1 / 30); // bend, and never straighten
    // change posture and stay there — the tap row's gate is shut throughout,
    // so nothing inside it can ever reach the release branch
    let t = 2 / 30;
    for (let i = 0; i < 60; i++, t += 1 / 30) g.update(palmHand(), t);
    // Let palm's posture grace window (POSTURE_GRACE_S = 0.4) expire so twoFinger
    // can become true during the swipe. Without this delay, twoFinger stays false
    // and stepping is blocked by the posture gate, not by tapInFlight.
    for (let i = 0; i < 13; i++, t += 1 / 30) g.update(twoFingerHand(), t);
    expect(swipe(g, t)).toContain("step");
  });

  it("still opens on a real double tap", () => {
    const g = new GestureEngine();
    const evs: GestureEvent[] = [];
    // straight first to establish this hand's straight-finger length, then
    // bend/straighten twice — the double click
    const frames = [
      twoFingerHand(),
      tapHand(),
      twoFingerHand(),
      tapHand(),
      twoFingerHand(),
    ];
    frames.forEach((h, i) => evs.push(...g.update(h, i / 30)));
    expect(types(evs)).toContain("open");
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

describe("GestureEngine: two-palm zoom", () => {
  // both hands as palms, `gap` apart and centred — the whole signal is the
  // span between the two wrists
  const spread = (g: GestureEngine, i: number, gap: number) =>
    g.update(palmHand(0.5 - gap / 2), i / 30, palmHand(0.5 + gap / 2));

  it("hands apart zooms in, together zooms out, held still emits nothing", () => {
    const apart = new GestureEngine();
    const fs: number[] = [];
    for (let i = 0; i < 8; i++)
      for (const ev of spread(apart, i, 0.2 + i * 0.06))
        if (ev.type === "zoom") fs.push(ev.factor);
    expect(fs.length).toBeGreaterThan(0);
    expect(fs.every((f) => f > 1 && f <= ZOOM_MAX_RATE)).toBe(true);

    const together = new GestureEngine();
    const gs: number[] = [];
    for (let i = 0; i < 8; i++)
      for (const ev of spread(together, i, 0.7 - i * 0.06))
        if (ev.type === "zoom") gs.push(ev.factor);
    expect(gs.length).toBeGreaterThan(0);
    expect(gs.every((f) => f < 1 && f >= 1 / ZOOM_MAX_RATE)).toBe(true);

    const still = new GestureEngine();
    for (let i = 0; i < 8; i++)
      expect(types(spread(still, i, 0.4))).not.toContain("zoom");
  });

  it("one palm alone no longer zooms — the second hand is the gesture", () => {
    const g = new GestureEngine();
    const evs: GestureEvent[] = [];
    for (let i = 0; i < 8; i++)
      evs.push(...g.update(scaledPalmHand(0.2 + i * 0.02), i / 30));
    expect(types(evs)).not.toContain("zoom");
  });

  // the one-hand table stands down while both palms are up, so a hand that
  // rolls as it spreads cannot spin the camera at the same time
  it("a roll while both palms are up does not orbit", () => {
    const g = new GestureEngine();
    const evs: GestureEvent[] = [];
    for (let i = 0; i < 8; i++)
      evs.push(
        ...g.update(
          rolledPalmHand(i * 0.15, 0.4 - i * 0.02),
          i / 30,
          palmHand(0.6 + i * 0.02),
        ),
      );
    expect(types(evs)).toContain("zoom");
    expect(types(evs)).not.toContain("orbit");
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

describe("GestureEngine: leaving two-palm mode", () => {
  // Both palms up for `frames` at 30fps starting at t=0, primary hand at 0.3
  // and second at 0.7. Returns the next timestamp to use.
  const twoPalm = (g: GestureEngine, frames: number, t0 = 0): number => {
    let t = t0;
    for (let i = 0; i < frames; i++, t += 1 / 30)
      g.update(palmHand(0.3), t, palmHand(0.7));
    return t;
  };

  it("a hand held still after a zoom does not spin the camera", () => {
    const g = new GestureEngine();
    g.update(palmHand(), 0);
    // the primary hand rolls while the hands spread — which is what wrists
    // do when you pull them apart — so the frozen roll angle has a delta to
    // discharge on the way out
    let t = 1 / 30;
    for (let i = 0; i < 15; i++, t += 1 / 30)
      g.update(rolledPalmHand(i * 0.055, 0.3), t, palmHand(0.7));
    const still = rolledPalmHand(14 * 0.055, 0.3);
    const evs: GestureEvent[] = [];
    for (let i = 0; i < 20; i++, t += 1 / 30) evs.push(...g.update(still, t));
    expect(types(evs)).not.toContain("orbit");
  });

  it("does not re-arm on the way out — a fresh palm hold is still required", () => {
    const g = new GestureEngine();
    g.update(palmHand(), 0); // one palm first: this is what banks palmT
    const t = twoPalm(g, 60, 1 / 30); // 2s of two-palm mode
    const evs: GestureEvent[] = [];
    // past the 0.4s posture grace, but well under PALM_HOLD_S from the exit
    for (let i = 0; i < 18; i++) evs.push(...g.update(palmHand(), t + i / 30));
    expect(types(evs)).not.toContain("arm");
  });

  it("does not disarm on the way out — a fresh fist hold is still required", () => {
    const g = new GestureEngine();
    // a brief fist, well under FIST_HOLD_S, correctly disarms nothing
    for (let i = 0; i < 12; i++) g.update(fistHand(), i / 30);
    const t = twoPalm(g, 48, 12 / 30);
    const evs: GestureEvent[] = [];
    // past the grace window; a real disarm needs a full second beyond it
    for (let i = 0; i < 21; i++) evs.push(...g.update(fistHand(), t + i / 30));
    expect(types(evs)).not.toContain("disarm");
  });

  it("pans on the first pinch after a zoom", () => {
    const g = new GestureEngine();
    let t = twoPalm(g, 10);
    const evs: GestureEvent[] = [];
    for (let i = 0; i < 30; i++, t += 1 / 30)
      evs.push(...g.update(shifted(pinchedHand(), i * 0.02, 0), t));
    expect(types(evs)).toContain("drag");
  });

  it("snaps a drag that is still open when the second palm arrives", () => {
    const g = new GestureEngine();
    g.update(pinchedHand(0.3), 0);
    g.update(shifted(pinchedHand(0.3), 0.05, 0), 1 / 30);
    // the pinch opens into a palm on the same frame the second palm appears
    const evs = g.update(palmHand(0.3), 2 / 30, palmHand(0.7));
    expect(types(evs)).toContain("snap");
  });
});

describe("GestureEngine: swipe at low frame rates", () => {
  // the same 10-frame swipe, replayed at different capture rates. MediaPipe
  // falls back to CPU inference with no GPU delegate, commonly 10-15fps, and
  // the step gesture must survive that rather than silently not existing.
  const stepsAt = (fps: number): number => {
    const g = new GestureEngine();
    let steps = 0;
    for (let i = 0; i < 10; i++)
      for (const ev of g.update(fingerSwipeHand(i * 0.06), i / fps))
        if (ev.type === "step") steps++;
    return steps;
  };

  it("steps at 8, 12, 20 and 30 fps alike", () => {
    for (const fps of [8, 12, 20, 30])
      expect({ fps, steps: stepsAt(fps) > 0 }).toEqual({ fps, steps: true });
  });
});
