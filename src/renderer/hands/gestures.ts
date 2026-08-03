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
export const SWIPE_STEP = 0.15; // two-finger travel per ring step
export const FIST_HOLD_S = 1.0;
export const PALM_HOLD_S = 1.0; // starting value, tune on a real camera

// ponytail: postures were read per frame, so one noisy frame — a borderline
// finger flipping, which MediaPipe does constantly — cleared every
// accumulator gated on that posture. That is why a roll stopped after one
// throw and a swipe never reached SWIPE_STEP: both restarted from zero mid
// gesture. A posture now survives its own dropout for this long.
export const POSTURE_GRACE_S = 0.4;

// Forward-tap z hysteresis, in wrist-scale units. MediaPipe z is negative
// toward the camera and hand-tracker.ts does not mirror it, so a poke drives
// the signal MORE negative — pinned: TAP_Z_ENGAGE < TAP_Z_RELEASE < 0, the
// same way PINCH_ENGAGE < PINCH_RELEASE pins the pinch (design §5).
// ponytail: -0.35/-0.2 was a guess and the row reportedly never fires; z is
// roughly x-scaled, so a tip sits ~0.05 ahead of its knuckle against a
// ~0.2 wrist scale ≈ -0.25 peak, which -0.35 can't reach. Halved. Still a
// guess — read `tap` off the HUD and set these from a real hand.
export const TAP_Z_ENGAGE = -0.18;
export const TAP_Z_RELEASE = -0.08;
export const TAP_DOUBLE_S = 0.5; // starting value, tune on a real camera

// Zoom: full comfortable arm travel is only ~1.5× of raw scale, so the gain
// exponent maps it to a useful range; the rate clamp keeps one dropped-
// tracking frame from teleporting the camera. ZOOM_DEADZONE has its own unit:
// the smoother's default 0.008 is a fraction of FRAME WIDTH tuned for wrist
// position — scale sits around 0.15–0.3, where 0.008 swallows slow deliberate
// zooms (design §5). Starting values, tune on a real camera; tune ZOOM_GAIN
// together with ROLL_MIN_RAD_S — they decide which signal wins the axis lock.
export const ZOOM_GAIN = 3;
export const ZOOM_MAX_RATE = 1.15;
export const ZOOM_DEADZONE = 0.002;

const INDEX_MCP = 5;

// what the HUD renders — every threshold in this file is a guess until it is
// read off a real hand, so the numbers behind each gate are published
export type HandDebug = {
  tracked: boolean;
  pinch: number;
  fingers: Record<Finger, boolean>;
  posture: "palm" | "two" | "fist" | "none";
  roll: number; // rad/s, post dead zone (0 = below ROLL_MIN_RAD_S)
  swipe: number; // travel banked toward the next SWIPE_STEP
  tap: number; // forward-tap z signal, vs TAP_Z_ENGAGE
  events: string[];
};

const FINGERS_NONE: Record<Finger, boolean> = {
  index: false,
  middle: false,
  ring: false,
  pinky: false,
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

type Frame = {
  hand: Landmark[];
  t: number;
  pinch: PinchState;
  x: number;
  y: number;
  twoFinger: boolean;
  palm: boolean;
  fist: boolean;
};

export class GestureEngine {
  private pinchDet = new PinchDetector();
  private smoother = new AnchorSmoother();
  private smootherY = new AnchorSmoother();
  private wasPinching = false;
  private lastX: number | null = null; // pinch-drag anchor
  private lastY: number | null = null;
  private swipeLastX: number | null = null;
  private swipe = 0;
  private fistT: number | null = null;
  private palmT: number | null = null;
  private tapEngaged = false;
  private lastFlickT: number | null = null;
  private lastScale: number | null = null;
  private roll = new RollTracker();
  private scaleSmoother = new AnchorSmoother(ZOOM_DEADZONE);
  private twoFingerHeld = new HeldPosture();
  private palmHeld = new HeldPosture();
  private lastRollV = 0;
  private lastTap = 0;

  // the gesture table — every row sees the same frame
  private rows: Array<(f: Frame) => GestureEvent[]> = [
    (f) => this.pinchDrag(f),
    (f) => this.twoFingerStep(f),
    (f) => this.forwardTap(f),
    (f) => this.palmCamera(f),
    (f) => this.fistDisarm(f),
    (f) => this.palmArm(f),
  ];

  // Last frame's posture inputs, for tuning against a real camera — every
  // threshold in this file is a guess until someone reads these numbers off
  // their own hand. use-hand-control publishes it on window.__hands.
  debug: HandDebug = {
    tracked: false,
    pinch: 0,
    fingers: FINGERS_NONE,
    posture: "none",
    roll: 0,
    swipe: 0,
    tap: 0,
    events: [],
  };

  update(hand: Landmark[] | null, t: number): GestureEvent[] {
    if (!hand) {
      const lost = this.handLost();
      this.debug = {
        ...this.debug,
        tracked: false,
        pinch: 0,
        fingers: FINGERS_NONE,
        posture: "none",
        roll: 0,
        swipe: 0,
        tap: 0,
        events: lost.map((e) => e.type),
      };
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
    const palm = this.palmHeld.update(!pinch.isPinching && n === 4, t);
    const twoFinger =
      this.twoFingerHeld.update(
        !pinch.isPinching &&
          fingers.index &&
          fingers.middle &&
          !fingers.ring &&
          !fingers.pinky,
        t,
      ) && !palm; // palm wins the overlap the grace windows can create
    const fist = !pinch.isPinching && n === 0;
    const frame: Frame = { hand, t, pinch, x, y, twoFinger, palm, fist };
    const events: GestureEvent[] = [];
    for (const row of this.rows) events.push(...row(frame));
    this.debug = {
      tracked: true,
      pinch: pinch.normalizedDistance,
      fingers,
      posture: palm ? "palm" : twoFinger ? "two" : fist ? "fist" : "none",
      roll: this.lastRollV,
      swipe: this.swipe,
      tap: this.lastTap,
      // sticky: the HUD polls at 5 Hz and the tracker runs at 30, so a frame's
      // events would be invisible four times out of five. This is "last fired".
      events: events.length ? events.map((e) => e.type) : this.debug.events,
    };
    return events;
  }

  // hand out of view: end an in-flight pinch cleanly, reset transient state
  private handLost(): GestureEvent[] {
    const events: GestureEvent[] = this.wasPinching ? [{ type: "snap" }] : [];
    this.pinchDet = new PinchDetector();
    this.wasPinching = false;
    this.lastX = null;
    this.lastY = null;
    this.swipeLastX = null;
    this.swipe = 0;
    this.fistT = null;
    this.palmT = null;
    this.tapEngaged = false;
    this.lastFlickT = null;
    this.lastScale = null;
    this.roll.reset();
    this.scaleSmoother = new AnchorSmoother(ZOOM_DEADZONE);
    this.twoFingerHeld.reset();
    this.palmHeld.reset();
    this.lastRollV = 0;
    this.lastTap = 0;
    return events;
  }

  private pinchDrag(f: Frame): GestureEvent[] {
    const events: GestureEvent[] = [];
    if (f.pinch.justEngaged) {
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

  private twoFingerStep(f: Frame): GestureEvent[] {
    if (!f.twoFinger) {
      this.swipeLastX = null;
      this.swipe = 0;
      return [];
    }
    if (this.swipeLastX === null) {
      this.swipeLastX = f.x;
      return [];
    }
    this.swipe += f.x - this.swipeLastX;
    this.swipeLastX = f.x;
    if (Math.abs(this.swipe) < SWIPE_STEP) return [];
    const dir: 1 | -1 = this.swipe > 0 ? 1 : -1;
    this.swipe = 0; // re-arm: another SWIPE_STEP of travel = another step
    return [{ type: "step", dir }];
  }

  // Two forward flicks of index+middle open. z hysteresis in the shape of
  // PinchDetector — the pattern, not the class, since the input is a
  // different signal. Shares its posture with twoFingerStep and stays
  // distinct by axis: step watches x, this watches z. Fallback if a real
  // camera says z is unusable: dist2D(tip, MCP)/scale foreshortens the same
  // way and drops into this hysteresis unchanged (design §5).
  private forwardTap(f: Frame): GestureEvent[] {
    // Posture loss does NOT reset this row. Poking two fingers at the camera
    // foreshortens them, and foreshortening is the one thing a 2D posture
    // test cannot see — so the gate blinks out during the exact motion this
    // row exists to detect, and clearing here meant a flick could never be
    // completed or paired. TAP_DOUBLE_S is the bound; only handLost() clears.
    if (!f.twoFinger) return [];
    const wrist = f.hand[WRIST];
    const mcp = f.hand[MIDDLE_MCP];
    const scale = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
    if (scale === 0) return [];
    const tips = f.hand[TIPS.index].z + f.hand[TIPS.middle].z;
    const knuckles = f.hand[INDEX_MCP].z + f.hand[MIDDLE_MCP].z;
    const signal = (tips - knuckles) / 2 / scale;
    this.lastTap = signal;
    if (!this.tapEngaged) {
      if (signal < TAP_Z_ENGAGE) this.tapEngaged = true;
      return [];
    }
    if (signal > TAP_Z_RELEASE) {
      this.tapEngaged = false;
      if (this.lastFlickT !== null && f.t - this.lastFlickT <= TAP_DOUBLE_S) {
        this.lastFlickT = null;
        return [{ type: "open" }];
      }
      this.lastFlickT = f.t;
    }
    return [];
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

  // One row, not two: orbit and zoom are the same posture, and roll.ts owns
  // the angle maths while the zoom scalar is three lines inline.
  //
  // ponytail: the axis lock is gone. It locked to whichever signal crossed
  // its dead zone first, but orbit's signal is a derivative — it crosses on
  // hand tremor alone, so orbit won every race and zoom was unreachable. The
  // two signals are near-orthogonal anyway (rolling the hand barely changes
  // wrist→MCP distance), so each dead zone is its own guard and both rows may
  // fire on one frame. If roll turns out to bleed into scale on a real
  // camera, raise ZOOM_DEADZONE — do not bring the race back.
  private palmCamera(f: Frame): GestureEvent[] {
    if (!f.palm) {
      this.lastScale = null;
      this.lastRollV = 0;
      this.roll.reset();
      this.scaleSmoother = new AnchorSmoother(ZOOM_DEADZONE);
      return [];
    }
    const v = this.roll.update(knuckleAngle(f.hand), f.t);
    this.lastRollV = v;
    const wrist = f.hand[WRIST];
    const mcp = f.hand[MIDDLE_MCP];
    const scale = this.scaleSmoother.update(
      Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y),
      f.t,
    );
    // deadzone holds the smoothed value when still, so raw is exactly 1 and a
    // still palm cannot creep the zoom — the same property ROLL_MIN_RAD_S
    // buys for orbit
    const raw =
      this.lastScale === null || this.lastScale === 0
        ? 1
        : scale / this.lastScale;
    this.lastScale = scale;
    const events: GestureEvent[] = [];
    if (v !== 0) events.push({ type: "orbit", v });
    if (raw !== 1) {
      const factor = Math.min(
        ZOOM_MAX_RATE,
        Math.max(1 / ZOOM_MAX_RATE, Math.pow(raw, ZOOM_GAIN)),
      );
      events.push({ type: "zoom", factor });
    }
    return events;
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
