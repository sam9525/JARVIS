import { useCallback, useEffect, useRef } from "react";
import { Color } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { COLORS } from "./graph-colors";
import { displayRadius, sphereRadius } from "./graph-metrics";
import { endId, type LinkObj, type NodeObj } from "./link-ends";

type SceneHandle = {
  scene(): { add(o: object): void; remove(o: object): void };
};

/**
 * Write one link's two endpoints into `buf` at offset `o`, clamped to the
 * SPHERE SURFACES rather than the centres so a line doesn't spear through the
 * middle of a node. Writes in place (no allocation) — this runs for every link
 * on every engine tick.
 *
 * Spheres too close to leave room collapse the segment to a point.
 */
export function writeLinkSegment(
  buf: Float32Array,
  o: number,
  s: NodeObj | undefined,
  t: NodeObj | undefined,
  nodeSize: number,
): void {
  const sx = s?.x ?? 0;
  const sy = s?.y ?? 0;
  const sz = s?.z ?? 0;
  const tx = t?.x ?? 0;
  const ty = t?.y ?? 0;
  const tz = t?.z ?? 0;
  const dx = tx - sx;
  const dy = ty - sy;
  const dz = tz - sz;
  const len = Math.hypot(dx, dy, dz);
  const ra = sphereRadius(displayRadius(s?.r ?? 4, nodeSize, 0));
  const rb = sphereRadius(displayRadius(t?.r ?? 4, nodeSize, 0));
  if (len > ra + rb) {
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    buf[o] = sx + ux * ra;
    buf[o + 1] = sy + uy * ra;
    buf[o + 2] = sz + uz * ra;
    buf[o + 3] = tx - ux * rb;
    buf[o + 4] = ty - uy * rb;
    buf[o + 5] = tz - uz * rb;
    return;
  }
  // spheres overlapping — no room for a line; collapse it to a point
  buf[o] = buf[o + 3] = sx;
  buf[o + 1] = buf[o + 4] = sy;
  buf[o + 2] = buf[o + 5] = sz;
}

/**
 * Fleet (`lite`) view: draw ALL edges as one merged fat-line object instead of
 * a Line2 per edge. Hundreds of link draw calls — and their transparency-sort
 * entries — collapse to one, which is the whole point of the mode.
 *
 * Returns the position writer to hand to onEngineTick; it is a no-op until the
 * layer exists, so callers can wire it unconditionally.
 */
export function useMergedLinks(
  fgRef: React.MutableRefObject<SceneHandle | undefined>,
  enabled: boolean,
  links: LinkObj[],
  nodeById: Map<string, NodeObj>,
  linkColors: Map<string, string>,
  material: LineMaterial,
  nodeSize: number,
): () => void {
  const merged = useRef<{
    buf: Float32Array;
    posBuffer: { needsUpdate: boolean }; // the geometry's backing buffer
  }>();

  const writePositions = useCallback(() => {
    const m = merged.current;
    if (!m) return;
    const buf = m.buf;
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      writeLinkSegment(
        buf,
        i * 6,
        nodeById.get(endId(l.source)),
        nodeById.get(endId(l.target)),
        nodeSize,
      );
    }
    // buf IS the geometry's backing store, so flag it for re-upload rather than
    // setPositions() (which reallocates the GPU buffer). Ticks only fire during
    // the settle; rotating at rest pays nothing.
    m.posBuffer.needsUpdate = true;
  }, [links, nodeById, nodeSize]);

  // stable handle so the setup effect doesn't re-run on a slider change
  const writeRef = useRef(writePositions);
  writeRef.current = writePositions;

  useEffect(() => {
    if (!enabled) return;
    const scene = fgRef.current?.scene();
    if (!scene) return;
    const geo = new LineSegmentsGeometry();
    const n = links.length;
    const buf = new Float32Array(n * 6);
    const colors = new Float32Array(n * 6);
    const sc = new Color();
    const tc = new Color();
    for (let i = 0; i < n; i++) {
      const l = links[i];
      sc.set(linkColors.get(endId(l.source)) ?? COLORS.link);
      tc.set(linkColors.get(endId(l.target)) ?? COLORS.link);
      const o = i * 6;
      colors[o] = sc.r;
      colors[o + 1] = sc.g;
      colors[o + 2] = sc.b;
      colors[o + 3] = tc.r;
      colors[o + 4] = tc.g;
      colors[o + 5] = tc.b;
    }
    geo.setPositions(buf); // buf becomes the geometry's backing store
    geo.setColors(colors); // static per graph — set once
    const obj = new LineSegments2(geo, material);
    obj.frustumCulled = false; // bbox is stale between ticks; never cull it
    scene.add(obj);
    const posBuffer = (
      geo.getAttribute("instanceStart") as unknown as {
        data: { needsUpdate: boolean };
      }
    ).data;
    merged.current = { buf, posBuffer };
    writeRef.current(); // fill real coords (zeros pre-layout) + flag upload
    return () => {
      scene.remove(obj);
      geo.dispose();
      merged.current = undefined;
    };
  }, [enabled, links, linkColors, material, fgRef]);

  return writePositions;
}
