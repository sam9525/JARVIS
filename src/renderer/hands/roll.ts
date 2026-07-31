// Pure: knuckle-line angle → unwrapped, smoothed, dead-zoned, clamped angular
// velocity (rad/s). The palm-camera row feeds this; the ±π seam is the one
// place a naive diff breaks silently (design §5).
import { OneEuroFilter } from "./one-euro";
import type { Landmark } from "./pinch";

export const INDEX_MCP = 5;
export const PINKY_MCP = 17;

// starting values, tune on a real camera — tune ROLL_MIN_RAD_S together with
// ZOOM_GAIN: the pair decides which signal wins the axis lock in practice
export const ROLL_MIN_RAD_S = 0.8; // below this a still hand cannot creep the camera
export const ROLL_MAX_RAD_S = 6; // above this a hard flick cannot launch it

// angle of the knuckle line, index MCP → pinky MCP; null when degenerate
export function knuckleAngle(hand: Landmark[]): number | null {
  const dx = hand[PINKY_MCP].x - hand[INDEX_MCP].x;
  const dy = hand[PINKY_MCP].y - hand[INDEX_MCP].y;
  if (dx === 0 && dy === 0) return null;
  return Math.atan2(dy, dx);
}

// shift next by whole turns so |next − prev| ≤ π
export function unwrap(prev: number, next: number): number {
  const tau = 2 * Math.PI;
  let d = (next - prev) % tau;
  if (d > Math.PI) d -= tau;
  if (d < -Math.PI) d += tau;
  return prev + d;
}

export class RollTracker {
  private f = new OneEuroFilter();
  private lastAngle: number | null = null;
  private lastT: number | null = null;

  reset(): void {
    this.f = new OneEuroFilter();
    this.lastAngle = null;
    this.lastT = null;
  }

  update(angle: number | null, t: number): number {
    if (angle === null) return 0;
    if (this.lastAngle === null || this.lastT === null || t <= this.lastT) {
      this.lastAngle = angle;
      this.lastT = t;
      return 0;
    }
    const unwrapped = unwrap(this.lastAngle, angle);
    const v = (unwrapped - this.lastAngle) / (t - this.lastT);
    this.lastAngle = unwrapped;
    this.lastT = t;
    const smoothed = this.f.filter(v, t);
    if (Math.abs(smoothed) < ROLL_MIN_RAD_S) return 0;
    return Math.max(-ROLL_MAX_RAD_S, Math.min(ROLL_MAX_RAD_S, smoothed));
  }
}
