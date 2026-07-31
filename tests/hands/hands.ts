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

const base = (x: number): Landmark[] => {
  const h: Landmark[] = Array.from({ length: 21 }, () => ({
    x,
    y: 0.65,
    z: 0,
  }));
  h[WRIST] = { x, y: 0.8, z: 0 };
  h[MIDDLE_MCP] = { x, y: 0.6, z: 0 };
  for (const pip of PIPS) h[pip] = { x, y: 0.55, z: 0 };
  h[THUMB_TIP] = { x: x - 0.15, y: 0.65, z: 0 }; // 0.15 from index tip → norm 0.75, no pinch
  return h;
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

/** two-finger posture with index+middle tips poked toward the camera.
 *  depth −0.12 over hand scale 0.2 → signal −0.6, past TAP_Z_ENGAGE. */
export const flickHand = (x = 0.5, depth = -0.12): Landmark[] => {
  const h = twoFingerHand(x);
  h[INDEX_TIP] = { ...h[INDEX_TIP], z: depth };
  h[MIDDLE_TIP] = { ...h[MIDDLE_TIP], z: depth };
  return h;
};

/** palm with the knuckle line (index MCP → pinky MCP) at `angle` radians */
const INDEX_MCP = 5;
const PINKY_MCP = 17;

export const rolledPalmHand = (angle: number, x = 0.5): Landmark[] => {
  const h = palmHand(x);
  const r = 0.1;
  h[INDEX_MCP] = {
    x: x - r * Math.cos(angle),
    y: 0.6 - r * Math.sin(angle),
    z: 0,
  };
  h[PINKY_MCP] = {
    x: x + r * Math.cos(angle),
    y: 0.6 + r * Math.sin(angle),
    z: 0,
  };
  return h;
};

/** translate a whole hand — vertical pinch drags, etc. */
export const shifted = (h: Landmark[], dx: number, dy: number): Landmark[] =>
  h.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z }));
