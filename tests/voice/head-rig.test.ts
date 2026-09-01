import { describe, it, expect } from "vitest";
import { resolveRig, type RigObject } from "../../src/renderer/voice/head-rig";
import { buildModel } from "../../src/renderer/voice/head-mesh";

const PAIR = {
  positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0, 2, 1, 0],
  indices: [0, 1, 2, 1, 3, 2],
};
const model = () => buildModel(PAIR.positions, PAIR.indices);

const morphMesh = (names: string[]): RigObject => ({
  isMesh: true,
  morphTargetDictionary: Object.fromEntries(names.map((n, i) => [n, i])),
  morphTargetInfluences: names.map(() => 0),
});
const bone = (name: string): RigObject => ({
  isBone: true,
  name,
  rotation: { x: 0 },
});
const scene = (children: RigObject[]): RigObject => ({ children });

describe("resolveRig", () => {
  it("finds a morph target by name", () => {
    const rig = resolveRig(
      scene([morphMesh(["blink", "jawOpen"])]),
      model(),
      null,
      null,
    );
    expect(rig.kind).toBe("morph");
  });

  it("writes the amount into the matching influence only", () => {
    const mesh = morphMesh(["blink", "jawOpen"]);
    const rig = resolveRig(scene([mesh]), model(), null, null);
    rig.apply(0.5);
    expect(mesh.morphTargetInfluences).toEqual([0, 0.5]);
  });

  // The list ranks jaw shapes above vowel shapes, and a scene puts its meshes
  // in whatever order the exporter did — so the rank has to outrank the order.
  it("takes the better-named morph from a later mesh", () => {
    const vowel = morphMesh(["viseme_aa"]);
    const jaw = morphMesh(["jawOpen"]);
    const rig = resolveRig(scene([vowel, jaw]), model(), null, null);
    rig.apply(0.5);
    expect(vowel.morphTargetInfluences).toEqual([0]);
    expect(jaw.morphTargetInfluences).toEqual([0.5]);
  });

  it("falls back to a jaw bone when there is no morph target", () => {
    const b = bone("Head_Jaw");
    const rig = resolveRig(scene([b]), model(), null, null);
    expect(rig.kind).toBe("bone");
    rig.apply(1);
    expect(b.rotation!.x).toBeGreaterThan(0);
  });

  it("prefers a morph target over a jaw bone", () => {
    const rig = resolveRig(
      scene([bone("jaw"), morphMesh(["mouthOpen"])]),
      model(),
      null,
      null,
    );
    expect(rig.kind).toBe("morph");
  });

  it("uses a detected region when the model has no rig", () => {
    const rig = resolveRig(scene([]), model(), null, { c: [0, 0, 0], r: 10 });
    expect(rig.kind).toBe("detected");
  });

  it("lets a manual pick outrank a real morph target", () => {
    const rig = resolveRig(
      scene([morphMesh(["jawOpen"])]),
      model(),
      { c: [0, 0, 0], r: 10 },
      { c: [0, 0, 0], r: 10 },
    );
    expect(rig.kind).toBe("manual");
  });

  it("reports none when nothing answers, and applying is a no-op", () => {
    const m = model();
    const rig = resolveRig(scene([]), m, null, null);
    expect(rig.kind).toBe("none");
    rig.apply(1);
    expect([...m.pose]).toEqual([...m.verts]);
  });

  it("moves the pose for a region tier and returns it at zero", () => {
    const m = model();
    const rig = resolveRig(scene([]), m, { c: [0, 0, 0], r: 10 }, null);
    rig.apply(1);
    expect([...m.pose]).not.toEqual([...m.verts]);
    rig.apply(0);
    expect([...m.pose]).toEqual([...m.verts]);
  });
});
