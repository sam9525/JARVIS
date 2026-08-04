// Synthetic 21-landmark hands. Geometry: wrist (x, 0.8), middle MCP (x, 0.6)
// → hand scale 0.2. PIPs sit at y 0.55 (0.25 from wrist); a default tip at
// y 0.65 (0.15 from wrist) reads as curled, a tip at y 0.35 as extended.
import {
  INDEX_TIP,
  MIDDLE_MCP,
  THUMB_TIP,
  WRIST,
  type Landmark,
} from "../../src/renderer/hands/pinch";

const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;
const PIPS = [6, 10, 14, 18];

const INDEX_MCP = 5;
const PINKY_MCP = 17;

const base = (x: number): Landmark[] => {
  const h: Landmark[] = Array.from({ length: 21 }, () => ({
    x,
    y: 0.65,
    z: 0,
  }));
  h[WRIST] = { x, y: 0.8, z: 0 };
  h[MIDDLE_MCP] = { x, y: 0.6, z: 0 };
  // the knuckle line spans ±0.1 about the middle MCP, so it has a real angle
  // (atan2 → 0 at rest) instead of being degenerate until a roll helper
  // pokes two points into it
  h[INDEX_MCP] = { x: x - 0.1, y: 0.62, z: 0 };
  h[PINKY_MCP] = { x: x + 0.1, y: 0.62, z: 0 };
  for (const pip of PIPS) h[pip] = { x, y: 0.55, z: 0 };
  h[THUMB_TIP] = { x: x - 0.15, y: 0.65, z: 0 }; // 0.15 from index tip → norm 0.75, no pinch
  return h;
};

// Rotate and scale a whole hand about the wrist. The old helpers displaced
// two knuckles and left the fingers behind, so a "rolled" fixture was a hand
// no camera could produce and a "pushed" one stretched a single knuckle —
// neither could be used to reason about a posture gate.
const transform = (h: Landmark[], angle: number, k: number): Landmark[] => {
  const o = h[WRIST];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return h.map((p) => {
    const dx = (p.x - o.x) * k;
    const dy = (p.y - o.y) * k;
    return {
      x: o.x + dx * cos - dy * sin,
      y: o.y + dx * sin + dy * cos,
      z: p.z,
    };
  });
};

/** all four fingers curled, no pinch — a fist */
export const fistHand = (x = 0.5): Landmark[] => base(x);

/** thumb and index tips together (norm 0.1 < engage 0.35) */
export const pinchedHand = (x = 0.5): Landmark[] => {
  const h = base(x);
  h[THUMB_TIP] = { x, y: 0.5, z: 0 };
  h[INDEX_TIP] = { x: x + 0.02, y: 0.5, z: 0 };
  return h;
};

/** every finger extended, tips far apart — the neutral "doing nothing" hand */
export const palmHand = (x = 0.5): Landmark[] => {
  const h = base(x);
  for (const tip of [INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP])
    h[tip] = { x, y: 0.35, z: 0 };
  h[THUMB_TIP] = { x: x - 0.2, y: 0.5, z: 0 };
  return h;
};

/** index + middle extended, ring + pinky curled, no pinch */
export const twoFingerHand = (x = 0.5): Landmark[] => {
  const h = base(x);
  h[INDEX_TIP] = { x, y: 0.35, z: 0 };
  h[MIDDLE_TIP] = { x, y: 0.35, z: 0 };
  return h;
};

/** index + middle extended with the ring half-open — the posture a real hand
 *  makes, where one folded finger sits on the tip-vs-PIP line and reads
 *  extended. Must still count as two fingers. */
export const strayFingerHand = (x = 0.5): Landmark[] => {
  const h = twoFingerHand(x);
  h[RING_TIP] = { x, y: 0.35, z: 0 };
  return h;
};

/** two-finger posture with index+middle bent back toward their knuckles — the
 *  tap. `k` is the fraction of extension kept, which is exactly the ratio the
 *  tap gate reads: 1 is straight, 0.3 is well past TAP_BEND_ENGAGE. */
export const tapHand = (x = 0.5, k = 0.3): Landmark[] => {
  const h = twoFingerHand(x);
  const bend = (tip: number, knuckle: number) => {
    const t = h[tip];
    const m = h[knuckle];
    h[tip] = { x: m.x + (t.x - m.x) * k, y: m.y + (t.y - m.y) * k, z: t.z };
  };
  bend(INDEX_TIP, INDEX_MCP);
  bend(MIDDLE_TIP, MIDDLE_MCP);
  return h;
};

/** two-finger posture with the fingers swung `dx` sideways at the knuckle:
 *  the tips move, the wrist does not move at all */
export const fingerSwipeHand = (dx: number, x = 0.5): Landmark[] => {
  const h = twoFingerHand(x);
  for (const tip of [INDEX_TIP, MIDDLE_TIP])
    h[tip] = { ...h[tip], x: h[tip].x + dx };
  return h;
};

/** a tap bent far enough that the thumb sits on the bent index tip — what a
 *  real tap does, and what PinchDetector reads as a pinch */
export const pinchingTapHand = (x = 0.5): Landmark[] => {
  const h = tapHand(x);
  h[THUMB_TIP] = { ...h[INDEX_TIP] };
  return h;
};

/** palm rolled so the knuckle line sits at `angle` radians — a whole-hand
 *  rotation, so every finger stays as extended as it was at rest */
export const rolledPalmHand = (angle: number, x = 0.5): Landmark[] =>
  transform(palmHand(x), angle, 1);

/** palm at a given hand scale (wrist→middle-MCP distance): moving toward the
 *  camera scales the whole hand, it does not stretch one knuckle. Zoom no
 *  longer reads this — the test that pins that keeps the fixture. */
export const scaledPalmHand = (scale: number, x = 0.5): Landmark[] =>
  transform(palmHand(x), 0, scale / 0.2);

/** translate a whole hand — vertical pinch drags, etc. */
export const shifted = (h: Landmark[], dx: number, dy: number): Landmark[] =>
  h.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z }));
