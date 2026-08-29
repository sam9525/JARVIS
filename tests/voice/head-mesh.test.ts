import { describe, it, expect } from "vitest";
import {
  aimFrom,
  buildModel,
  visibleEdges,
  MAX_YAW,
  MAX_PITCH,
  recomputeNormals,
  regionMask,
  displaceRegion,
  resetPose,
  normalisePoint,
} from "../../src/renderer/voice/head-mesh";

// One triangle facing +z, in glTF's Y-up axes. Counter-clockwise seen from
// +z, which is the winding glTF calls front-facing.
const TRI = {
  positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0],
  indices: [0, 1, 2],
};
// A second triangle sharing the 1-2 edge, so the pair has five unique edges.
const PAIR = {
  positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0, 2, 1, 0],
  indices: [0, 1, 2, 1, 3, 2],
};

describe("buildModel", () => {
  it("collapses the edge two triangles share", () => {
    const one = buildModel(TRI.positions, TRI.indices);
    const two = buildModel(PAIR.positions, PAIR.indices);
    expect(one.ea.length).toBe(3);
    expect(two.ea.length).toBe(5);
  });

  it("records the face on each side, and -1 at a boundary", () => {
    const m = buildModel(PAIR.positions, PAIR.indices);
    const shared = [...m.ef2].filter((f) => f >= 0);
    expect(shared).toHaveLength(1); // only the 1-2 edge has two faces
    expect([...m.ef2].filter((f) => f < 0)).toHaveLength(4);
    expect(shared[0]).toBe(1);
  });

  it("flips glTF's Y-up to the app's Y-down", () => {
    const m = buildModel(TRI.positions, TRI.indices);
    // the apex is highest in glTF, so it must end up most negative on screen
    expect(m.verts[7]).toBeLessThan(m.verts[1]);
  });

  it("centres the mesh and scales it to two units tall", () => {
    const m = buildModel([0, 10, 0, 4, 10, 0, 2, 30, 0], TRI.indices);
    const ys = [m.verts[1], m.verts[4], m.verts[7]];
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2, 6);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(0, 6);
  });

  it("survives a flat mesh instead of dividing by a zero height", () => {
    const m = buildModel([0, 0, 0, 1, 0, 0, 0, 0, 1], TRI.indices);
    expect([...m.verts].every(Number.isFinite)).toBe(true);
  });
});

describe("visibleEdges", () => {
  it("draws a face turned toward the viewer and drops one turned away", () => {
    const m = buildModel(TRI.positions, TRI.indices);
    expect(visibleEdges(m, 0, 0, 1)).toHaveLength(3 * 4);
    expect(visibleEdges(m, Math.PI, 0, 1)).toHaveLength(0);
  });

  it("keeps an edge whose other face is still visible", () => {
    const m = buildModel(PAIR.positions, PAIR.indices);
    expect(visibleEdges(m, 0, 0, 1)).toHaveLength(5 * 4);
  });

  it("scales the segments it returns", () => {
    const m = buildModel(TRI.positions, TRI.indices);
    const one = Array.from(visibleEdges(m, 0, 0, 1));
    const ten = Array.from(visibleEdges(m, 0, 0, 10));
    one.forEach((v, i) => expect(ten[i]).toBeCloseTo(v * 10, 5));
  });

  it("turns the mesh, so the face follows the pointer", () => {
    const m = buildModel(TRI.positions, TRI.indices);
    const front = Array.from(visibleEdges(m, 0, 0, 1));
    const turned = Array.from(visibleEdges(m, MAX_YAW, 0, 1));
    expect(turned).not.toEqual(front);
  });

  it("hands back a view of one buffer, not a fresh array each frame", () => {
    const m = buildModel(TRI.positions, TRI.indices);
    expect(visibleEdges(m, 0, 0, 1).buffer).toBe(m.seg.buffer);
  });

  // normalisation is by height, so a model far deeper than it is tall can put
  // a vertex at or past the camera and emit Infinity/NaN segments
  it("keeps a deep model's projection finite", () => {
    const model = buildModel(
      [-0.1, -0.1, 0, 0.1, -0.1, 0, 0, 0.1, 0.8],
      [0, 1, 2],
    );
    const segs = visibleEdges(model, 0, 0, 76);
    for (let i = 0; i < segs.length; i++) expect(Number.isFinite(segs[i])).toBe(true);
  });
});

describe("aimFrom", () => {
  it("faces front when the pointer is at the centre of the app", () => {
    expect(aimFrom(500, 400, 1000, 800)).toEqual({ yaw: 0, pitch: -0 });
  });

  it("looks up and to the left for a pointer at the top left", () => {
    const { yaw, pitch } = aimFrom(0, 0, 1000, 800);
    expect(yaw).toBeCloseTo(-MAX_YAW, 5);
    expect(pitch).toBeCloseTo(MAX_PITCH, 5);
  });

  it("looks down and to the right for a pointer at the bottom right", () => {
    const { yaw, pitch } = aimFrom(1000, 800, 1000, 800);
    expect(yaw).toBeCloseTo(MAX_YAW, 5);
    expect(pitch).toBeCloseTo(-MAX_PITCH, 5);
  });

  it("clamps a pointer dragged outside the window", () => {
    expect(aimFrom(-500, 4000, 1000, 800).yaw).toBeCloseTo(-MAX_YAW, 5);
    expect(aimFrom(-500, 4000, 1000, 800).pitch).toBeCloseTo(-MAX_PITCH, 5);
  });
});

describe("recomputeNormals", () => {
  it("reproduces buildModel's normals on the rest pose", () => {
    const m = buildModel(PAIR.positions, PAIR.indices);
    const before = [...m.nx, ...m.ny, ...m.nz];
    // scramble, then rebuild from the untouched pose
    m.nx.fill(0);
    m.ny.fill(0);
    m.nz.fill(0);
    recomputeNormals(m);
    expect([...m.nx, ...m.ny, ...m.nz]).toEqual(before);
  });
});

describe("regionMask", () => {
  const m = buildModel(PAIR.positions, PAIR.indices);

  it("weights a vertex at the centre fully and one at the radius not at all", () => {
    const at = [m.verts[0], m.verts[1], m.verts[2]] as [number, number, number];
    const mask = regionMask(m, { c: at, r: 0.5 });
    const slot = [...mask.idx].indexOf(0);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(Math.abs(mask.w[slot])).toBeCloseTo(1, 5);
  });

  it("leaves a vertex outside the radius out of the mask entirely", () => {
    const mask = regionMask(m, { c: [99, 99, 99], r: 0.1 });
    expect(mask.idx.length).toBe(0);
  });

  it("signs the mask so the two sides of the centre move apart", () => {
    const mask = regionMask(m, { c: [0, 0, 0], r: 10 });
    const signs = new Set([...mask.w].map((w) => Math.sign(w)));
    expect(signs.has(1)).toBe(true);
    expect(signs.has(-1)).toBe(true);
  });
});

describe("normalisePoint", () => {
  it("puts a raw glTF point exactly where buildModel put it", () => {
    const m = buildModel(PAIR.positions, PAIR.indices);
    const out = new Float32Array(3);
    // the first raw vertex, back through the same centre-and-scale
    normalisePoint(m, PAIR.positions[0], PAIR.positions[1], PAIR.positions[2], out, 0);
    expect(out[0]).toBeCloseTo(m.verts[0], 5);
    expect(out[1]).toBeCloseTo(m.verts[1], 5);
    expect(out[2]).toBeCloseTo(m.verts[2], 5);
  });
});

describe("displaceRegion", () => {
  it("moves only the masked vertices and never compounds", () => {
    const m = buildModel(PAIR.positions, PAIR.indices);
    const mask = regionMask(m, { c: [m.verts[0], m.verts[1], m.verts[2]], r: 0.5 });
    const untouched = m.verts.length / 3 === mask.idx.length ? -1 : 3;
    displaceRegion(m, mask, 1);
    const once = m.pose[1];
    displaceRegion(m, mask, 1);
    expect(m.pose[1]).toBeCloseTo(once, 6); // second call starts from rest
    if (untouched >= 0) expect(m.pose[untouched * 3 + 1]).toBe(m.verts[untouched * 3 + 1]);
  });

  it("returns the pose to rest", () => {
    const m = buildModel(PAIR.positions, PAIR.indices);
    const mask = regionMask(m, { c: [m.verts[0], m.verts[1], m.verts[2]], r: 0.5 });
    displaceRegion(m, mask, 1);
    resetPose(m, mask);
    expect([...m.pose]).toEqual([...m.verts]);
  });
});
