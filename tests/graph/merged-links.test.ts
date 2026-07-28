import { describe, it, expect } from "vitest";
import { writeLinkSegment } from "../../src/renderer/graph/use-merged-links";
import {
  displayRadius,
  sphereRadius,
} from "../../src/renderer/graph/graph-metrics";

// radius of a node with base r at the given nodeSize, cold (the merged link
// layer is the static fleet view, which never runs highlights)
const surfaceOf = (r: number, nodeSize: number) =>
  sphereRadius(displayRadius(r, nodeSize, 0));

const seg = (
  s: Record<string, number> | undefined,
  t: Record<string, number> | undefined,
  nodeSize = 1,
) => {
  const buf = new Float32Array(6);
  writeLinkSegment(buf, 0, s, t, nodeSize);
  return Array.from(buf);
};

describe("writeLinkSegment", () => {
  it("starts and ends at the sphere surfaces, not the centres", () => {
    // two tiny nodes far apart on the x axis — plenty of room for a line
    const ra = surfaceOf(0.5, 1);
    const rb = surfaceOf(0.5, 1);
    const [sx, sy, sz, tx, ty, tz] = seg(
      { x: 0, y: 0, z: 0, r: 0.5 },
      { x: 500, y: 0, z: 0, r: 0.5 },
    );
    expect(sx).toBeCloseTo(ra, 4);
    expect(tx).toBeCloseTo(500 - rb, 4);
    expect([sy, sz, ty, tz]).toEqual([0, 0, 0, 0]);
  });

  it("collapses to a point when the spheres overlap", () => {
    // same node radius, centres 1 unit apart — no room between the surfaces
    expect(seg({ x: 7, y: 8, z: 9, r: 4 }, { x: 8, y: 8, z: 9, r: 4 })).toEqual(
      [7, 8, 9, 7, 8, 9],
    );
  });

  it("shortens the line as nodeSize grows the spheres", () => {
    const small = seg({ x: 0, y: 0, z: 0, r: 1 }, { x: 900, y: 0, z: 0, r: 1 }, 0.5); // prettier-ignore
    const large = seg({ x: 0, y: 0, z: 0, r: 1 }, { x: 900, y: 0, z: 0, r: 1 }, 3); // prettier-ignore
    expect(large[0]).toBeGreaterThan(small[0]); // starts further out
    expect(large[3]).toBeLessThan(small[3]); // ends further back
  });

  it("offsets each end by its OWN radius", () => {
    const [sx, , , tx] = seg(
      { x: 0, y: 0, z: 0, r: 0.5 },
      { x: 800, y: 0, z: 0, r: 6 },
    );
    expect(sx).toBeCloseTo(surfaceOf(0.5, 1), 4);
    expect(800 - tx).toBeCloseTo(surfaceOf(6, 1), 4);
    expect(800 - tx).toBeGreaterThan(sx); // the fatter node eats more line
  });

  it("treats a node missing from the map as the origin at the default radius", () => {
    // pre-layout, or a link whose endpoint was filtered out of the graph
    const [sx, sy, sz] = seg(undefined, { x: 900, y: 0, z: 0, r: 0.5 });
    expect(sx).toBeCloseTo(surfaceOf(4, 1), 4); // default r = 4
    expect([sy, sz]).toEqual([0, 0]);
  });

  it("writes at the given offset without touching neighbouring links", () => {
    const buf = new Float32Array(12).fill(-1);
    writeLinkSegment(buf, 6, { x: 0, y: 0, z: 0, r: 4 }, { x: 0, y: 0, z: 0, r: 4 }, 1); // prettier-ignore
    expect(Array.from(buf.slice(0, 6))).toEqual([-1, -1, -1, -1, -1, -1]);
    expect(Array.from(buf.slice(6))).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
