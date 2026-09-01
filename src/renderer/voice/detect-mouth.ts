import type { MouthRegion } from "../../shared/types";
import { installMediaPipeTelemetryBlock } from "../hands/hand-tracker";
import type { HeadModel } from "./head-mesh";

/**
 * Where the mouth is on a head model that ships no rig.
 *
 * The head is rendered front-on, a face detector marks the lips in that image,
 * and the lip centroid is matched back to the nearest vertex — giving a centre
 * and a radius in the model's own normalised space, which is what
 * `Settings.headMouths` stores and what `regionMask` consumes.
 *
 * This runs once, at load. Nothing here is on the speaking path.
 *
 * The arithmetic is pure and tested; the `FaceLandmarker` call is the effectful
 * boundary, like `load-head.ts` and `hand-tracker.ts`.
 */

export type Landmark = { x: number; y: number };

/**
 * The MediaPipe FaceMesh lip points: both corners, and the inner and outer
 * upper and lower lip. Verify these against the FaceMesh index map — a wrong
 * index puts the mouth on a cheek, and no unit test can catch it.
 */
export const LIP_LANDMARKS = [61, 291, 13, 14, 0, 17];

// Model-space distance the camera sits at, matching head-mesh's own DIST.
const DIST = 4;
// A mouth is wider than the lip landmarks it is measured from; the region has
// to reach the skin either side of them to look like an opening.
const REACH = 1.6;

/** The lip landmarks reduced to a centre and a half-extent, in image units. */
export function lipBounds(
  pts: Landmark[],
  idx: number[],
): { cx: number; cy: number; spread: number } | null {
  if (!idx.length) return null;
  let sx = 0;
  let sy = 0;
  let mnX = Infinity;
  let mxX = -Infinity;
  let mnY = Infinity;
  let mxY = -Infinity;
  for (const i of idx) {
    const p = pts[i];
    if (!p) return null;
    sx += p.x;
    sy += p.y;
    mnX = Math.min(mnX, p.x);
    mxX = Math.max(mxX, p.x);
    mnY = Math.min(mnY, p.y);
    mxY = Math.max(mxY, p.y);
  }
  return {
    cx: sx / idx.length,
    cy: sy / idx.length,
    spread: Math.max(mxX - mnX, mxY - mnY) / 2,
  };
}

/**
 * An image-space lip centroid mapped onto the model.
 *
 * The head was rendered front-on, so the projection is the one `visibleEdges`
 * uses at yaw 0 and pitch 0: a vertex lands at `x * DIST / (DIST - z) * scale`.
 * The nearest vertex to the centroid is the mouth centre, and the spread is
 * converted at that vertex's own depth so a deep-set mouth is not undersized.
 */
export function regionAt(
  m: HeadModel,
  cx: number,
  cy: number,
  spread: number,
  scale: number,
  size: number,
): MouthRegion {
  // landmarks are 0..1 from the top-left of a square render of `size` pixels;
  // the model projects into the same pixels around a centred origin
  const tx = (cx - 0.5) * size;
  const ty = (cy - 0.5) * size;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0, v = 0; v < m.verts.length; i++, v += 3) {
    const z = m.verts[v + 2];
    const k = (DIST / Math.max(DIST - z, 0.1)) * scale;
    const d = Math.hypot(m.verts[v] * k - tx, m.verts[v + 1] * k - ty);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const v = best * 3;
  const k = (DIST / Math.max(DIST - m.verts[v + 2], 0.1)) * scale;
  const half = Math.max((spread * size * REACH) / k, 1e-3);
  return {
    c: [m.verts[v], m.verts[v + 1], m.verts[v + 2]],
    // The landmarks give one spread, and a mouth is about twice as wide as it
    // is tall — a square box would take in the nose and the chin with it.
    w: half,
    h: half * 0.5,
    d: half,
  };
}

/**
 * Find the mouth in a front-on render of the head, or `null`.
 *
 * `null` is a real answer, not a failure: a helmet, an animal or a stylised
 * head has no face to find, and nothing downstream may guess a region from it.
 */
export async function detectMouth(
  m: HeadModel,
  image: HTMLCanvasElement,
  scale: number,
  size: number,
): Promise<MouthRegion | null> {
  const restoreTelemetry = installMediaPipeTelemetryBlock();
  try {
    const { FaceLandmarker, FilesetResolver } =
      await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks("/hands/wasm");
    const detector = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: "/voice/face_landmarker.task" },
      runningMode: "IMAGE",
      numFaces: 1,
    });
    const result = detector.detect(image);
    detector.close();
    const pts = result.faceLandmarks?.[0];
    if (!pts) return null;
    const bounds = lipBounds(pts, LIP_LANDMARKS);
    return bounds
      ? regionAt(m, bounds.cx, bounds.cy, bounds.spread, scale, size)
      : null;
  } catch (err) {
    // A missing asset on a fresh clone lands here. Detection is one tier of
    // five, so it degrades to the next one rather than costing the head.
    console.warn("mouth detection unavailable", err);
    return null;
  } finally {
    restoreTelemetry();
  }
}
