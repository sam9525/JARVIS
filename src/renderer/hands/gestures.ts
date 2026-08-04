// Pure: landmark frames → gesture events. `rows` is the gesture table and
// the extension point — a new gesture is a row (posture predicate + motion
// rule), not new control flow (design §6). t is seconds.

import { AnchorSmoother } from "./one-euro";
import {
  MIDDLE_MCP,
  PinchDetector,
  WRIST,
  type Landmark,
  type PinchState,
} from "./pinch";
import { knuckleAngle, RollTracker } from "./roll";

export type GestureEvent =
  | { type: "drag"; dx: number; dy: number } // normalized hand units; sign matches pointer
  | { type: "snap" }
  | { type: "open" }
  | { type: "step"; dir: 1 | -1 }
  | { type: "disarm" }
  | { type: "arm" }
  | { type: "orbit"; v: number } // signed rad/s, dead-zoned + clamped
  | { type: "zoom"; factor: number }; // per-frame multiplicative ratio; >1 = zoom in

const TIPS = { index: 8, middle: 12, ring: 16, pinky: 20 } as const;
const PIPS = { index: 6, middle: 10, ring: 14, pinky: 18 } as const;
export type Finger = keyof typeof TIPS;

// a finger is extended when its tip sits farther from the wrist than its PIP.
// Checked against whole-hand rotation and against foreshortening across the
// knuckle line: the comparison survives both, so this is not the reason a
// posture-gated gesture fails to fire. Left alone deliberately.
export function fingerExtended(hand: Landmark[], finger: Finger): boolean {
  const wrist = hand[WRIST];
  const d = (i: number) => Math.hypot(hand[i].x - wrist.x, hand[i].y - wrist.y);
  return d(TIPS[finger]) > d(PIPS[finger]);
}

// starting values, to be tuned against a real camera (design §6)
export const FIST_HOLD_S = 1.0;
export const PALM_HOLD_S = 1.0; // starting value, tune on a real camera

// A swipe is a fast movement, so it is measured as one — frame widths per
// second, with a cooldown after each step. Banked travel (the old SWIPE_STEP)
// could not tell a flick from a drift, fired once per fixed distance so one
// sweep stepped four times, and counted the return stroke as a swipe the
// other way: every step right was undone by the hand coming back to a
// comfortable position. The cooldown swallows that return and caps a held
// sweep at about two steps a second.
//
// Measured over a window off the RAW fingertips, not frame-to-frame off the
// smoothed wrist anchor. One frame's delta is noise, and AnchorSmoother's job
// is to steady a drag anchor — it lags a flick badly and its dead zone
// quantizes slow motion to zero, so a deliberate swipe came out under
// threshold. The tips read a knuckle-pivot swing as well as a whole-hand
// sweep; the wrist only read the sweep.
export const SWIPE_SPEED = 0.4;
export const SWIPE_WINDOW_S = 0.15;
export const SWIPE_COOLDOWN_S = 0.45;
// Fingers move in a tap, the hand moves in a swipe. Above this the hand is
// swiping, so the tap must not engage: a fast sweep blurs the landmarks, the
// finger-length ratio dips through the shallow TAP_BEND_ENGAGE, and the tap
// row then stood the step row down for a full TAP_DOUBLE_S — the swipe
// suppressed itself. Generous on purpose, so a tap with an unsteady hand
// still registers.
export const TAP_STILL_SPEED = 1.0;

// Postures read per frame flicker — a borderline finger flips for a frame,
// which MediaPipe does constantly — and every accumulator gated on one
// restarted mid-gesture: a roll stopped after a single throw, a swipe never
// built up speed. A posture survives its own dropout for this long.
export const POSTURE_GRACE_S = 0.4;

// Tap hysteresis on MCP→tip length, as FRACTIONS of this hand's own
// straight-finger length rather than absolutes: that length over wrist→MCP
// depends on finger-to-palm proportion and on how far the camera angle
// flattens the hand, so no constant is right for every hand. ENGAGE < RELEASE
// pins it the way PINCH_ENGAGE < PINCH_RELEASE pins the pinch; low is bent.
// The 12% dip is deliberately shallow, and the cost is that a 12% wobble
// repeated inside TAP_DOUBLE_S can open something — walk this pair back first
// if stray opens appear.
export const TAP_BEND_ENGAGE = 0.88;
export const TAP_BEND_RELEASE = 0.95;
// the running max bleeds ~15%/s toward the current length: one frame of
// MediaPipe overshoot must not raise the bar for the rest of the session
export const TAP_MAX_DECAY = 0.995;
export const TAP_DOUBLE_S = 1.0; // two taps is a rhythm, not a timing feat
// A tap is quick. Unbounded, any straightening completes one — a hand resting
// slightly curled sits engaged indefinitely, so merely extending the fingers
// fired a tap. Held longer than this it is a posture, and is discarded.
export const TAP_HOLD_MAX_S = 0.45;

// Zoom is the span between two palms — hands apart zooms in, the way every
// touchscreen pinch works. One palm pushed at the camera used to drive it,
// but that signal is wrist→MCP distance, which barely moves over the whole
// comfortable arm travel and shares its posture with the orbit. Two hands
// spread across most of the frame instead, so the gain needs no amplification
// (the one-hand version needed 3). Both units are fractions of frame width.
// The rate clamp keeps one dropped-tracking frame from teleporting the camera.
export const ZOOM_GAIN = 1;
export const ZOOM_MAX_RATE = 1.15;
export const ZOOM_DEADZONE = 0.008;

const INDEX_MCP = 5;

// what the HUD renders — every threshold in this file is a guess until it is
// read off a real hand, so the numbers behind each gate are published
export type HandDebug = {
  tracked: boolean;
  pinch: number;
  fingers: Record<Finger, boolean>;
  posture: "palms" | "palm" | "two" | "fist" | "none";
  roll: number; // rad/s, post dead zone (0 = below ROLL_MIN_RAD_S)
  swipe: number; // hand speed in frame widths per second, vs SWIPE_SPEED
  tap: number; // finger length over this hand's straight, vs TAP_BEND_ENGAGE
  span: number; // wrist-to-wrist distance driving the zoom, 0 with one hand
  events: string[];
};

const FINGERS_NONE: Record<Finger, boolean> = {
  index: false,
  middle: false,
  ring: false,
  pinky: false,
};

// every reading a lost hand has; only `events` survives it
const DEBUG_UNTRACKED: Omit<HandDebug, "events"> = {
  tracked: false,
  pinch: 0,
  fingers: FINGERS_NONE,
  posture: "none",
  roll: 0,
  swipe: 0,
  tap: 0,
  span: 0,
};

// a posture, held for POSTURE_GRACE_S past its last true frame
class HeldPosture {
  private lastTrue: number | null = null;
  update(on: boolean, t: number): boolean {
    if (on) {
      this.lastTrue = t;
      return true;
    }
    if (this.lastTrue !== null && t - this.lastTrue < POSTURE_GRACE_S)
      return true;
    this.lastTrue = null;
    return false;
  }
  reset(): void {
    this.lastTrue = null;
  }
}

// all four fingers extended — the camera hand
const isPalm = (hand: Landmark[]): boolean =>
  (["index", "middle", "ring", "pinky"] as const).every((f) =>
    fingerExtended(hand, f),
  );

type Frame = {
  hand: Landmark[];
  second: Landmark[] | null;
  t: number;
  pinch: PinchState;
  x: number;
  y: number;
  twoFinger: boolean;
  palm: boolean;
  bothPalms: boolean;
  fist: boolean;
  speed: number; // signed frame widths per second, over SWIPE_WINDOW_S
};

export class GestureEngine {
  private pinchDet = new PinchDetector();
  private smoother = new AnchorSmoother();
  private smootherY = new AnchorSmoother();
  private wasPinching = false;
  private lastX: number | null = null; // pinch-drag anchor
  private lastY: number | null = null;
  private trail: Array<{ x: number; t: number }> = []; // raw wrist x, one window deep
  private lastStepT: number | null = null;
  private fistT: number | null = null;
  private palmT: number | null = null;
  private bentT: number | null = null; // when the fingers went bent, if they are
  private tapMax = 0; // this hand's straight index+middle length, measured
  private lastTapT: number | null = null; // one tap banked, waiting for its pair
  private tapActiveT: number | null = null; // last tap activity of any kind
  private lastSpan: number | null = null;
  private roll = new RollTracker();
  private spanSmoother = new AnchorSmoother(ZOOM_DEADZONE);
  private twoFingerHeld = new HeldPosture();
  private palmHeld = new HeldPosture();
  private bothPalmsHeld = new HeldPosture();
  private lastRollV = 0;
  private lastTap = 0;
  private wasBothPalms = false;

  // the one-hand gesture table — every row sees the same frame
  private rows: Array<(f: Frame) => GestureEvent[]> = [
    (f) => this.pinchDrag(f),
    // before the step row, so the frame a bend engages on is already
    // suppressed there rather than banking one last slice of travel
    (f) => this.twoFingerTap(f),
    (f) => this.twoFingerStep(f),
    (f) => this.palmCamera(f),
    (f) => this.fistDisarm(f),
    (f) => this.palmArm(f),
  ];

  // use-hand-control publishes this on window.__hands; HandsHud renders it
  debug: HandDebug = { ...DEBUG_UNTRACKED, events: [] };

  update(
    hand: Landmark[] | null,
    t: number,
    second: Landmark[] | null = null,
  ): GestureEvent[] {
    if (!hand) {
      const lost = this.handLost();
      this.debug = { ...DEBUG_UNTRACKED, events: this.sticky(lost) };
      return lost;
    }
    const pinch = this.pinchDet.update(hand, t);
    this.wasPinching = pinch.isPinching;
    const x = this.smoother.update(hand[WRIST].x, t);
    const y = this.smootherY.update(hand[WRIST].y, t);
    const fingers = {
      index: fingerExtended(hand, "index"),
      middle: fingerExtended(hand, "middle"),
      ring: fingerExtended(hand, "ring"),
      pinky: fingerExtended(hand, "pinky"),
    };
    const n = Object.values(fingers).filter(Boolean).length;
    // Two fingers tolerates one stray extended finger — a half-curled ring
    // sits right on the tip-vs-PIP line and flickers, which shut both
    // two-finger rows out — and ignores the pinch, because bending the
    // fingers carries the index tip toward the thumb, so a tap arrives as a
    // pinch and the drag row would eat it. Safe in both directions: a real
    // pinch curls the middle finger and so cannot satisfy this, and palm is
    // still the only posture with all four.
    const palm = this.palmHeld.update(!pinch.isPinching && n === 4, t);
    const twoFinger =
      this.twoFingerHeld.update(fingers.index && fingers.middle && n <= 3, t) &&
      !palm; // palm wins the overlap the grace windows can create
    const fist = !pinch.isPinching && n === 0;
    const bothPalms = this.bothPalmsHeld.update(
      palm && second !== null && isPalm(second),
      t,
    );
    const frame: Frame = {
      hand,
      second,
      t,
      pinch,
      x,
      y,
      twoFinger,
      palm,
      bothPalms,
      fist,
      // the fingertips, not the wrist: swinging the fingers at the knuckle
      // with the wrist planted is a swipe too, and the tips move whenever the
      // wrist does, so this reads whole-hand sweeps unchanged
      speed: this.speedOf(
        (hand[TIPS.index].x + hand[TIPS.middle].x) / 2,
        t,
        twoFinger,
      ),
    };
    // Two palms is a mode, not a row: while both are up the one-hand table
    // stands down, so spreading the hands to zoom cannot also roll the camera
    // or re-arm the session off the leading hand.
    // The rising edge is the only moment the one-hand rows can hand back
    // what they are holding — after this frame they do not run at all.
    const events: GestureEvent[] =
      bothPalms && !this.wasBothPalms ? this.endOneHand() : [];
    this.wasBothPalms = bothPalms;
    events.push(...this.twoPalmZoom(frame));
    if (!bothPalms) for (const row of this.rows) events.push(...row(frame));
    this.debug = {
      tracked: true,
      pinch: pinch.normalizedDistance,
      fingers,
      posture: bothPalms
        ? "palms"
        : palm
          ? "palm"
          : twoFinger
            ? "two"
            : fist
              ? "fist"
              : "none",
      roll: this.lastRollV,
      swipe: frame.speed,
      tap: this.lastTap,
      span: this.lastSpan ?? 0,
      events: this.sticky(events),
    };
    return events;
  }

  // the HUD polls at 5 Hz and the tracker runs at 30, so a frame's events
  // would be invisible four times out of five — this reads "last fired"
  private sticky(events: GestureEvent[]): string[] {
    return events.length ? events.map((e) => e.type) : this.debug.events;
  }

  // hand out of view: end an in-flight pinch cleanly, reset transient state
  private handLost(): GestureEvent[] {
    const events: GestureEvent[] = this.wasPinching ? [{ type: "snap" }] : [];
    this.pinchDet = new PinchDetector();
    this.wasPinching = false;
    this.lastX = null;
    this.lastY = null;
    this.trail = [];
    this.lastStepT = null;
    this.fistT = null;
    this.palmT = null;
    this.bentT = null;
    this.tapMax = 0;
    this.lastTapT = null;
    this.tapActiveT = null;
    this.lastSpan = null;
    this.roll.reset();
    this.spanSmoother = new AnchorSmoother(ZOOM_DEADZONE);
    this.twoFingerHeld.reset();
    this.palmHeld.reset();
    this.bothPalmsHeld.reset();
    this.lastRollV = 0;
    this.lastTap = 0;
    this.wasBothPalms = false;
    return events;
  }

  // The one-hand rows' own resets, run from outside them. Two-palm mode
  // stands those rows down, but they are also the only place their own
  // state is cleared, so freezing them left a stale roll angle to discharge
  // in one frame, hold clocks that had already run past their thresholds,
  // and a drag anchor with no way to close. Deliberately NOT handLost(): the
  // hand is still here, so the postures, the tap row and the swipe trail
  // keep everything they know.
  private endOneHand(): GestureEvent[] {
    // an open drag anchor is the whole test for an owed snap — it survives
    // the frame the pinch released on, which is exactly the frame the rows
    // stopped running and could not emit it themselves
    const events: GestureEvent[] = this.lastX !== null ? [{ type: "snap" }] : [];
    this.lastX = null;
    this.lastY = null;
    this.fistT = null;
    this.palmT = null;
    this.roll.reset();
    this.lastRollV = 0;
    return events;
  }

  private pinchDrag(f: Frame): GestureEvent[] {
    if (f.twoFinger) return []; // a tap's bend looks like a pinch; two fingers win
    const events: GestureEvent[] = [];
    // Level-triggered, not edge-triggered. `justEngaged` is a single frame
    // and it is computed at the top of update(), outside the rows — so the
    // two-palm gate and the twoFinger early return above can both eat it,
    // and an edge-only anchor then leaves lastX null with the pinch still
    // closed: the drag branch below can never run and pan is dead until a
    // full release. Adopting the anchor whenever a pinch is open with no
    // anchor costs one frame of travel and cannot dead-end.
    if (f.pinch.justEngaged || (f.pinch.isPinching && this.lastX === null)) {
      this.lastX = f.x;
      this.lastY = f.y;
    } else if (
      f.pinch.isPinching &&
      this.lastX !== null &&
      this.lastY !== null
    ) {
      const dx = f.x - this.lastX;
      const dy = f.y - this.lastY;
      this.lastX = f.x;
      this.lastY = f.y;
      if (dx !== 0 || dy !== 0) events.push({ type: "drag", dx, dy });
    }
    if (f.pinch.justReleased) {
      this.lastX = null;
      this.lastY = null;
      events.push({ type: "snap" });
    }
    return events;
  }

  // A tap in flight — the bend, plus the gap while its pair is still
  // possible. The hand drifts sideways while tapping and that drift is not a
  // swipe: untreated, a tap opened the project and stepped past it on the
  // way. Expires with the pairing window, so one stray bend cannot leave the
  // ring unswipeable.
  private tapInFlight(t: number): boolean {
    return (
      this.bentT !== null ||
      (this.tapActiveT !== null && t - this.tapActiveT <= TAP_DOUBLE_S)
    );
  }

  // Fingertip speed over the last SWIPE_WINDOW_S, measured only while two
  // fingers are up so motion from before the posture cannot swipe. Three is
  // the floor — two intervals average out a single noisy frame, and it is
  // reached in ~70 ms. A time-based floor is what NOT to use here: it reports
  // 0 during warm-up, and 0 reads as "the hand is still", which let a swipe
  // bank a phantom tap in its own first frames and then suppress itself.
  private speedOf(x: number, t: number, held: boolean): number {
    if (!held) {
      this.trail = [];
      return 0;
    }
    this.trail.push({ x, t });
    while (this.trail.length > 1 && t - this.trail[0].t > SWIPE_WINDOW_S)
      this.trail.shift();
    const dt = t - this.trail[0].t;
    return this.trail.length < 3 || dt <= 0 ? 0 : (x - this.trail[0].x) / dt;
  }

  private twoFingerStep(f: Frame): GestureEvent[] {
    if (!f.twoFinger) return [];
    if (this.tapInFlight(f.t)) return []; // the fingers are the gesture, not the hand
    if (Math.abs(f.speed) < SWIPE_SPEED) return [];
    // the rest of this flick, and the return stroke that follows it
    if (this.lastStepT !== null && f.t - this.lastStepT < SWIPE_COOLDOWN_S)
      return [];
    this.lastStepT = f.t;
    return [{ type: "step", dir: f.speed > 0 ? 1 : -1 }];
  }

  // Two taps of index+middle open — bend and straighten, twice, like a double
  // click. Hysteresis in the shape of PinchDetector (the pattern, not the
  // class: different signal). Shares its posture with twoFingerStep and stays
  // distinct by axis — step watches the wrist's x, this watches finger length,
  // and a swipe holds the fingers straight throughout. Do not reach back for
  // MediaPipe z: with the fingers pointing up, tips and knuckles sit at the
  // same depth and the signal is flat (design §5).
  private twoFingerTap(f: Frame): GestureEvent[] {
    // A bend outliving TAP_HOLD_MAX_S is a posture, not a tap — but the
    // release branch below is the only place that verdict was reached, and
    // it is unreachable while the two-finger gate is shut. So a bend
    // abandoned into another posture pinned tapInFlight() true forever and
    // twoFingerStep stayed dead until the hand left frame. Same bound,
    // applied where a shut gate cannot hide it. Discarded outright: routing
    // it through the release branch would re-stamp tapActiveT and block
    // stepping for a further TAP_DOUBLE_S.
    if (this.bentT !== null && f.t - this.bentT > TAP_HOLD_MAX_S) {
      this.bentT = null;
      this.tapActiveT = null;
    }
    // Posture loss does NOT reset this row. A deep bend reads as "not
    // extended", so the gate blinks out during the exact motion this row
    // exists to detect, and clearing here meant a tap could never be
    // completed or paired. TAP_DOUBLE_S is the bound; only handLost() clears.
    if (!f.twoFinger) return [];
    const wrist = f.hand[WRIST];
    const mcp = f.hand[MIDDLE_MCP];
    const scale = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
    if (scale === 0) return [];
    const len = (tip: number, knuckle: number) =>
      Math.hypot(
        f.hand[tip].x - f.hand[knuckle].x,
        f.hand[tip].y - f.hand[knuckle].y,
      );
    const signal =
      (len(TIPS.index, INDEX_MCP) + len(TIPS.middle, MIDDLE_MCP)) / 2 / scale;
    // straight-finger length measured rather than assumed. Tracked only while
    // the fingers read straight: bleeding during a bend would sink the bar
    // onto the bent length and the ratio would cross RELEASE on its own.
    if (this.bentT === null)
      this.tapMax = Math.max(signal, this.tapMax * TAP_MAX_DECAY);
    const straight = this.tapMax;
    this.lastTap = signal / straight; // the HUD shows what the gate compares
    if (this.bentT === null) {
      // a hand this fast is swiping, and a blurred swipe reads as bent
      if (Math.abs(f.speed) > TAP_STILL_SPEED) return [];
      if (signal < straight * TAP_BEND_ENGAGE) {
        this.bentT = f.t;
        this.tapActiveT = f.t;
      }
      return [];
    }
    if (signal > straight * TAP_BEND_RELEASE) {
      this.bentT = null;
      // every release marks activity, including the one that opens: the step
      // row reads this to stand down, and lifting it on the opening frame
      // would let the tap's own drift step the ring as it opened
      this.tapActiveT = f.t;
      if (this.lastTapT !== null && f.t - this.lastTapT <= TAP_DOUBLE_S) {
        this.lastTapT = null;
        return [{ type: "open" }];
      }
      this.lastTapT = f.t;
    }
    return [];
  }

  // Both palms up: the span between the wrists drives the zoom, hands apart
  // to zoom in. Raw frame-width distance, not normalized by hand scale —
  // dividing by a small noisy number to gain depth-invariance is a bad trade
  // when both hands moving toward the camera reads as zoom-in anyway.
  private twoPalmZoom(f: Frame): GestureEvent[] {
    if (!f.bothPalms || !f.second) {
      this.lastSpan = null;
      this.spanSmoother = new AnchorSmoother(ZOOM_DEADZONE);
      return [];
    }
    const a = f.hand[WRIST];
    const b = f.second[WRIST];
    const span = this.spanSmoother.update(
      Math.hypot(b.x - a.x, b.y - a.y),
      f.t,
    );
    const last = this.lastSpan;
    this.lastSpan = span;
    // the deadzone holds the smoothed value when still, so the ratio is
    // exactly 1 and held hands cannot creep the camera
    if (last === null || last === 0 || span === last) return [];
    const factor = Math.min(
      ZOOM_MAX_RATE,
      Math.max(1 / ZOOM_MAX_RATE, Math.pow(span / last, ZOOM_GAIN)),
    );
    return [{ type: "zoom", factor }];
  }

  private fistDisarm(f: Frame): GestureEvent[] {
    if (!f.fist) {
      this.fistT = null;
      return [];
    }
    if (this.fistT === null) {
      this.fistT = f.t;
      return [];
    }
    if (f.t - this.fistT < FIST_HOLD_S) return [];
    this.fistT = null; // fire once; holding on restarts the clock
    return [{ type: "disarm" }];
  }

  // Orbit only — roll.ts owns the angle maths. Zoom used to ride along here
  // as wrist→MCP scale, sharing the posture; it moved to two palms because
  // that distance barely changes across the whole comfortable arm travel.
  private palmCamera(f: Frame): GestureEvent[] {
    if (!f.palm) {
      this.lastRollV = 0;
      this.roll.reset();
      return [];
    }
    const v = this.roll.update(knuckleAngle(f.hand), f.t);
    this.lastRollV = v;
    return v === 0 ? [] : [{ type: "orbit", v }];
  }

  private palmArm(f: Frame): GestureEvent[] {
    if (!f.palm) {
      this.palmT = null;
      return [];
    }
    if (this.palmT === null) {
      this.palmT = f.t;
      return [];
    }
    if (f.t - this.palmT < PALM_HOLD_S) return [];
    this.palmT = null; // fire once; holding on restarts the clock
    return [{ type: "arm" }];
  }
}
