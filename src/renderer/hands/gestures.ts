// Pure: landmark frames → gesture events. `rows` is the gesture table and
// the extension point — a new gesture is a row (posture predicate + motion
// rule), not new control flow (design §6). t is seconds.

import { AnchorSmoother } from "./one-euro";
import { PinchDetector, WRIST, type Landmark, type PinchState } from "./pinch";

export type GestureEvent =
  | { type: "rotate"; dx: number } // normalized hand units; sign matches pointer dx
  | { type: "snap" }
  | { type: "open" }
  | { type: "step"; dir: 1 | -1 }
  | { type: "off" };

const TIPS = { index: 8, middle: 12, ring: 16, pinky: 20 } as const;
const PIPS = { index: 6, middle: 10, ring: 14, pinky: 18 } as const;
export type Finger = keyof typeof TIPS;

// a finger is extended when its tip sits farther from the wrist than its PIP
export function fingerExtended(hand: Landmark[], finger: Finger): boolean {
  const wrist = hand[WRIST];
  const d = (i: number) => Math.hypot(hand[i].x - wrist.x, hand[i].y - wrist.y);
  return d(TIPS[finger]) > d(PIPS[finger]);
}

// starting values, to be tuned against a real camera (design §6)
export const DOUBLE_TAP_S = 0.4; // widened from GazeControl's 0.35 — see MIN_REARM_S
export const TAP_MOVE_MAX = 0.04; // past this travel a pinch is a drag, not a tap
export const SWIPE_STEP = 0.15; // two-finger travel per ring step
export const FIST_HOLD_S = 1.0;

type Frame = { hand: Landmark[]; t: number; pinch: PinchState; x: number };

export class GestureEngine {
  private pinchDet = new PinchDetector();
  private smoother = new AnchorSmoother();
  private wasPinching = false;
  private lastX: number | null = null; // pinch-drag anchor
  private travel = 0;
  private lastTapT: number | null = null;
  private swipeLastX: number | null = null;
  private swipe = 0;
  private fistT: number | null = null;

  // the gesture table — every row sees the same frame
  private rows: Array<(f: Frame) => GestureEvent[]> = [
    (f) => this.pinchDrag(f),
    (f) => this.twoFingerStep(f),
    (f) => this.fistOff(f),
  ];

  update(hand: Landmark[] | null, t: number): GestureEvent[] {
    if (!hand) return this.handLost();
    const pinch = this.pinchDet.update(hand, t);
    this.wasPinching = pinch.isPinching;
    const x = this.smoother.update(hand[WRIST].x, t);
    const frame: Frame = { hand, t, pinch, x };
    const events: GestureEvent[] = [];
    for (const row of this.rows) events.push(...row(frame));
    return events;
  }

  // hand out of view: end an in-flight pinch cleanly, reset transient state
  private handLost(): GestureEvent[] {
    const events: GestureEvent[] = this.wasPinching ? [{ type: "snap" }] : [];
    this.pinchDet = new PinchDetector();
    this.wasPinching = false;
    this.lastX = null;
    this.swipeLastX = null;
    this.swipe = 0;
    this.fistT = null;
    return events;
  }

  private pinchDrag(f: Frame): GestureEvent[] {
    const events: GestureEvent[] = [];
    if (f.pinch.justEngaged) {
      this.travel = 0;
      this.lastX = f.x;
    } else if (f.pinch.isPinching && this.lastX !== null) {
      const dx = f.x - this.lastX;
      this.lastX = f.x;
      this.travel += Math.abs(dx);
      if (dx !== 0) events.push({ type: "rotate", dx });
    }
    if (f.pinch.justReleased) {
      this.lastX = null;
      events.push({ type: "snap" });
      if (this.travel <= TAP_MOVE_MAX) {
        // double-tap window runs release-to-release, as in gazeos click.py
        if (this.lastTapT !== null && f.t - this.lastTapT <= DOUBLE_TAP_S) {
          this.lastTapT = null;
          events.push({ type: "open" });
        } else {
          this.lastTapT = f.t;
        }
      } else {
        this.lastTapT = null; // a drag is never half of a double-tap
      }
    }
    return events;
  }

  private twoFingerStep(f: Frame): GestureEvent[] {
    const posture =
      !f.pinch.isPinching &&
      fingerExtended(f.hand, "index") &&
      fingerExtended(f.hand, "middle") &&
      !fingerExtended(f.hand, "ring") &&
      !fingerExtended(f.hand, "pinky");
    if (!posture) {
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

  private fistOff(f: Frame): GestureEvent[] {
    const fist =
      !f.pinch.isPinching &&
      !fingerExtended(f.hand, "index") &&
      !fingerExtended(f.hand, "middle") &&
      !fingerExtended(f.hand, "ring") &&
      !fingerExtended(f.hand, "pinky");
    if (!fist) {
      this.fistT = null;
      return [];
    }
    if (this.fistT === null) {
      this.fistT = f.t;
      return [];
    }
    if (f.t - this.fistT < FIST_HOLD_S) return [];
    this.fistT = null; // fire once; holding on restarts the clock
    return [{ type: "off" }];
  }
}
