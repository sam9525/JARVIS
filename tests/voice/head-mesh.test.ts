import { describe, it, expect } from "vitest";
import {
  aimFrom,
  buildModel,
  visibleEdges,
  MAX_YAW,
  MAX_PITCH,
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
