/**
 * The main agent's head as a wireframe: an edge list built from a triangle
 * mesh, rotated and projected to 2D segments.
 *
 * Only edges with a face turned toward the viewer are drawn. That is what
 * makes a dense mesh legible at 240×200 — drawing the far side through the
 * near side is what turns a helmet into a blob, not the triangle count.
 *
 * The maths is here, without three, so it stays unit-testable the way
 * `ring-layout` and `panel-layout` are; `load-head.ts` owns the GLB boundary.
 *
 * Coordinates are unit-ish: x right, y down (the crown is -1, the chin +1),
 * z toward the viewer, so the face looks out of the screen at z > 0.
 */

import type { MouthRegion } from "../../shared/types";

export type Pt = [number, number];

/** Widest turn in radians. Past this the mesh reads as a side profile. */
export const MAX_YAW = 0.6;
export const MAX_PITCH = 0.4;

// Camera distance. Near enough that the turned-toward side grows visibly, far
// enough that the silhouette does not bow.
const DIST = 4;

export type Norm = { scale: number; cx: number; cy: number; cz: number };

export type HeadModel = {
  /** Normalised xyz triples. */
  verts: Float32Array;
  /** The rest pose, drawn when nothing deforms it. `verts` is never mutated. */
  pose: Float32Array;
  /** Triangle corners in the swapped winding, so normals can be rebuilt. */
  tri: Uint32Array;
  /** The centre-and-scale that took the raw soup to normalised space, kept so
   *  a GPU-deformed vertex read back in raw units can take the same path. */
  norm: Norm;
  /** Edge endpoints, as vertex indices. */
  ea: Uint32Array;
  eb: Uint32Array;
  /** The faces either side of each edge; -1 where the mesh has a boundary. */
  ef1: Int32Array;
  ef2: Int32Array;
  /** Face normals. */
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  /** Per-frame scratch, allocated once so a frame allocates nothing. */
  px: Float32Array;
  py: Float32Array;
  vis: Uint8Array;
  seg: Float32Array;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Build the drawable model from a triangle soup in glTF's axes.
 *
 * glTF is Y-up, so y is negated; the mesh is then centred and scaled to span
 * 2 units tall, which is what lets one canvas scale suit any uploaded head.
 */
export function buildModel(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
): HeadModel {
  const verts = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    verts[i] = positions[i];
    verts[i + 1] = -positions[i + 1];
    verts[i + 2] = positions[i + 2];
  }
  let mnX = Infinity,
    mxX = -Infinity,
    mnY = Infinity,
    mxY = -Infinity,
    mnZ = Infinity,
    mxZ = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    mnX = Math.min(mnX, verts[i]);
    mxX = Math.max(mxX, verts[i]);
    mnY = Math.min(mnY, verts[i + 1]);
    mxY = Math.max(mxY, verts[i + 1]);
    mnZ = Math.min(mnZ, verts[i + 2]);
    mxZ = Math.max(mxZ, verts[i + 2]);
  }
  const scale = 2 / (mxY - mnY || 1);
  const cx = (mnX + mxX) / 2;
  const cy = (mnY + mxY) / 2;
  const cz = (mnZ + mxZ) / 2;
  for (let i = 0; i < verts.length; i += 3) {
    verts[i] = (verts[i] - cx) * scale;
    verts[i + 1] = (verts[i + 1] - cy) * scale;
    verts[i + 2] = (verts[i + 2] - cz) * scale;
  }

  const faces = indices.length / 3;
  const nx = new Float32Array(faces);
  const ny = new Float32Array(faces);
  const nz = new Float32Array(faces);
  // Edges keyed on their two vertex indices, low first, so the two triangles
  // sharing an edge collapse to one entry.
  const seen = new Map<number, number>();
  const ea: number[] = [];
  const eb: number[] = [];
  const ef1: number[] = [];
  const ef2: number[] = [];
  const triList: number[] = [];
  // The second and third corners are swapped because negating y mirrors the
  // space, which reverses every triangle's winding. Without the swap every
  // normal points inward and the cull keeps exactly the wrong half.
  for (let t = 0; t < indices.length; t += 3) {
    const f = t / 3;
    const ia = indices[t];
    const ib = indices[t + 2];
    const ic = indices[t + 1];
    const a = ia * 3;
    const b = ib * 3;
    const c = ic * 3;
    const ux = verts[b] - verts[a];
    const uy = verts[b + 1] - verts[a + 1];
    const uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a];
    const vy = verts[c + 1] - verts[a + 1];
    const vz = verts[c + 2] - verts[a + 2];
    const cnx = uy * vz - uz * vy;
    const cny = uz * vx - ux * vz;
    const cnz = ux * vy - uy * vx;
    const len = Math.hypot(cnx, cny, cnz) || 1;
    nx[f] = cnx / len;
    ny[f] = cny / len;
    nz[f] = cnz / len;
    const tri = [ia, ib, ic];
    triList.push(ia, ib, ic);
    for (let k = 0; k < 3; k++) {
      const p = tri[k];
      const q = tri[(k + 1) % 3];
      const lo = Math.min(p, q);
      const hi = Math.max(p, q);
      const key = lo * 0x400000 + hi;
      const at = seen.get(key);
      if (at === undefined) {
        seen.set(key, ea.length);
        ea.push(lo);
        eb.push(hi);
        ef1.push(f);
        ef2.push(-1);
      } else if (ef2[at] < 0) {
        ef2[at] = f;
      }
    }
  }

  const n = verts.length / 3;
  return {
    verts,
    pose: Float32Array.from(verts),
    tri: Uint32Array.from(triList),
    norm: { scale, cx, cy, cz },
    ea: Uint32Array.from(ea),
    eb: Uint32Array.from(eb),
    ef1: Int32Array.from(ef1),
    ef2: Int32Array.from(ef2),
    nx,
    ny,
    nz,
    px: new Float32Array(n),
    py: new Float32Array(n),
    vis: new Uint8Array(faces),
    seg: new Float32Array(ea.length * 4),
  };
}

/**
 * The segments to stroke, as x1,y1,x2,y2 runs in canvas units.
 *
 * The returned view is the model's own scratch buffer: read it before the
 * next call, and never keep it.
 */
export function visibleEdges(
  m: HeadModel,
  yaw: number,
  pitch: number,
  scale: number,
): Float32Array {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  for (let i = 0, v = 0; v < m.pose.length; i++, v += 3) {
    const x = m.pose[v];
    const y = m.pose[v + 1];
    const z = m.pose[v + 2];
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y1 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    // The mesh is normalised by height, so an uploaded model deep in z can put
    // a vertex at or past the camera. Held just short of it, that vertex
    // projects large instead of infinite.
    const k = (DIST / Math.max(DIST - z2, 0.1)) * scale;
    m.px[i] = x1 * k;
    m.py[i] = y1 * k;
  }
  // Only the rotated z of each normal decides visibility, so the other two
  // components are never computed.
  for (let f = 0; f < m.nx.length; f++) {
    const z1 = -m.nx[f] * sy + m.nz[f] * cy;
    m.vis[f] = m.ny[f] * sp + z1 * cp > 0 ? 1 : 0;
  }

  let n = 0;
  for (let e = 0; e < m.ea.length; e++) {
    const f2 = m.ef2[e];
    if (!m.vis[m.ef1[e]] && (f2 < 0 || !m.vis[f2])) continue;
    const a = m.ea[e];
    const b = m.eb[e];
    m.seg[n++] = m.px[a];
    m.seg[n++] = m.py[a];
    m.seg[n++] = m.px[b];
    m.seg[n++] = m.py[b];
  }
  return m.seg.subarray(0, n);
}

/** Pointer position to a head angle: the app's centre is the front face. */
export function aimFrom(
  x: number,
  y: number,
  w: number,
  h: number,
): { yaw: number; pitch: number } {
  return {
    yaw: (clamp01(x / w) - 0.5) * 2 * MAX_YAW,
    pitch: -(clamp01(y / h) - 0.5) * 2 * MAX_PITCH,
  };
}

/** Rebuild every face normal from the current pose. */
export function recomputeNormals(m: HeadModel): void {
  const p = m.pose;
  for (let f = 0, t = 0; t < m.tri.length; f++, t += 3) {
    const a = m.tri[t] * 3;
    const b = m.tri[t + 1] * 3;
    const c = m.tri[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const cnx = uy * vz - uz * vy;
    const cny = uz * vx - ux * vz;
    const cnz = ux * vy - uy * vx;
    const len = Math.hypot(cnx, cny, cnz) || 1;
    m.nx[f] = cnx / len;
    m.ny[f] = cny / len;
    m.nz[f] = cnz / len;
  }
}

/** The vertices a marked mouth moves, with a signed cosine falloff. */
export type RegionMask = { idx: Uint32Array; w: Float32Array };

// How far a fully-weighted vertex travels, as a share of the region's radius. A
// mouth that opens its own width reads as speech; more reads as a yawn.
const OPEN = 0.55;

/**
 * Vertices within the region, weighted 1 at the centre and 0 at the radius.
 *
 * The weight is signed by which side of the centre the vertex sits on — y is
 * down, so the lower lip takes a positive weight and the upper a negative one,
 * and the two travel apart rather than together.
 */
export function regionMask(m: HeadModel, region: MouthRegion): RegionMask {
  const [cx, cy, cz] = region.c;
  const r = Math.max(region.r, 1e-6);
  const idx: number[] = [];
  const w: number[] = [];
  for (let i = 0, v = 0; v < m.verts.length; i++, v += 3) {
    const d = Math.hypot(m.verts[v] - cx, m.verts[v + 1] - cy, m.verts[v + 2] - cz);
    if (d >= r) continue;
    const fall = 0.5 + 0.5 * Math.cos((d / r) * Math.PI);
    idx.push(i);
    w.push(m.verts[v + 1] < cy ? -fall : fall);
  }
  return { idx: Uint32Array.from(idx), w: Float32Array.from(w) };
}

/**
 * Open the marked mouth by `amount` (0–1).
 *
 * Every masked vertex is written from the rest pose, not from its last
 * position, so calling this each frame cannot compound.
 */
export function displaceRegion(
  m: HeadModel,
  mask: RegionMask,
  amount: number,
  radius = 1,
): void {
  const travel = amount * OPEN * radius;
  for (let k = 0; k < mask.idx.length; k++) {
    const v = mask.idx[k] * 3;
    m.pose[v + 1] = m.verts[v + 1] + mask.w[k] * travel;
  }
}

/** Put the masked vertices back where `buildModel` left them. */
export function resetPose(m: HeadModel, mask: RegionMask): void {
  for (let k = 0; k < mask.idx.length; k++) {
    const v = mask.idx[k] * 3;
    m.pose[v] = m.verts[v];
    m.pose[v + 1] = m.verts[v + 1];
    m.pose[v + 2] = m.verts[v + 2];
  }
}

/**
 * A point in the file's own glTF units, written into normalised head space.
 *
 * The same y-negation, centring and scaling `buildModel` applies, exposed so a
 * vertex read back off the GPU lands where the rest pose put it instead of at
 * the size of the file's bounding box.
 */
export function normalisePoint(
  m: HeadModel,
  x: number,
  y: number,
  z: number,
  out: Float32Array,
  at: number,
): void {
  const { scale, cx, cy, cz } = m.norm;
  out[at] = (x - cx) * scale;
  out[at + 1] = (-y - cy) * scale;
  out[at + 2] = (z - cz) * scale;
}
