import { describe, it, expect } from "vitest";
import { lipBounds, regionAt } from "../../src/renderer/voice/detect-mouth";
import { buildModel } from "../../src/renderer/voice/head-mesh";

describe("lipBounds", () => {
  it("centres on the lip landmarks and measures their spread", () => {
    const pts = [
      { x: 0.9, y: 0.9 }, // 0 — not a lip point, must be ignored
      { x: 0.4, y: 0.6 },
      { x: 0.6, y: 0.6 },
      { x: 0.5, y: 0.55 },
      { x: 0.5, y: 0.65 },
    ];
    const b = lipBounds(pts, [1, 2, 3, 4]);
    expect(b!.cx).toBeCloseTo(0.5, 6);
    expect(b!.cy).toBeCloseTo(0.6, 6);
    expect(b!.spread).toBeCloseTo(0.1, 6); // half the widest extent
  });

  it("returns null when the landmark list is empty", () => {
    expect(lipBounds([], [1, 2])).toBeNull();
  });

  it("returns null when an index is out of range", () => {
    expect(lipBounds([{ x: 0.5, y: 0.5 }], [0, 99])).toBeNull();
  });
});

describe("regionAt", () => {
  // a flat quad facing the camera, spanning x -1..1 and y -1..1 after
  // normalisation, so a projected centroid maps back to a known vertex
  const m = buildModel(
    [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
    [0, 1, 2, 0, 2, 3],
  );

  it("puts the centre on a real vertex of the model", () => {
    const r = regionAt(m, 0.5, 0.5, 0.1, 76, 200);
    expect(r.c.every((n) => Number.isFinite(n))).toBe(true);
    const verts: number[][] = [];
    for (let v = 0; v < m.verts.length; v += 3)
      verts.push([m.verts[v], m.verts[v + 1], m.verts[v + 2]]);
    expect(verts).toContainEqual(r.c);
  });

  it("picks the lower vertex for a centroid below the image centre", () => {
    const high = regionAt(m, 0.5, 0.2, 0.1, 76, 200);
    const low = regionAt(m, 0.5, 0.8, 0.1, 76, 200);
    expect(low.c[1]).toBeGreaterThan(high.c[1]); // y is down
  });

  it("scales the radius with the spread", () => {
    const narrow = regionAt(m, 0.5, 0.5, 0.05, 76, 200);
    const wide = regionAt(m, 0.5, 0.5, 0.2, 76, 200);
    expect(wide.r).toBeGreaterThan(narrow.r);
  });
});
