// Pure: hand landmarks → pinch state with hysteresis + re-arm debounce.
// Port of gazeos/gesture/pinch.py. Distances normalize by wrist→middle-MCP
// so distance from the camera does not matter. t is seconds.

// z: MediaPipe normalized depth, negative toward the camera (wrist origin).
// Kept for the forward-tap only — every distance below stays strictly 2D,
// because z is much coarser than x/y (design §5).
export type Landmark = { x: number; y: number; z: number };

export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;

export const PINCH_ENGAGE = 0.35;
export const PINCH_RELEASE = 0.45;
// GazeControl used 0.3 s, which left a double-tap ~50 ms of usable slack
// against its 0.35 s window; shrunk so a double-tap is a gesture, not a
// timing feat (design §6). Starting value — tune on a real camera.
export const MIN_REARM_S = 0.08;

export type PinchState = {
  isPinching: boolean;
  justEngaged: boolean;
  justReleased: boolean;
  normalizedDistance: number;
};

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

export function normalizedPinchDistance(hand: Landmark[]): number {
  const scale = dist(hand[MIDDLE_MCP], hand[WRIST]);
  if (scale === 0) return Infinity;
  return dist(hand[INDEX_TIP], hand[THUMB_TIP]) / scale;
}

export class PinchDetector {
  private pinching = false;
  private lastEngageT: number | null = null;

  update(hand: Landmark[], t: number): PinchState {
    const d = normalizedPinchDistance(hand);
    let engaged = false;
    let released = false;
    if (!this.pinching) {
      const rearmOk =
        this.lastEngageT === null || t - this.lastEngageT >= MIN_REARM_S;
      if (d < PINCH_ENGAGE && rearmOk) {
        this.pinching = true;
        this.lastEngageT = t;
        engaged = true;
      }
    } else if (d > PINCH_RELEASE) {
      this.pinching = false;
      released = true;
    }
    return {
      isPinching: this.pinching,
      justEngaged: engaged,
      justReleased: released,
      normalizedDistance: d,
    };
  }
}
