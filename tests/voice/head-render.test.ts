import { describe, it, expect } from "vitest";
import { Group } from "three";
import {
  pickOnScene,
  projectRegion,
} from "../../src/renderer/voice/head-render";
import { buildModel } from "../../src/renderer/voice/head-mesh";
import type { LoadedHead } from "../../src/renderer/voice/load-head";

// No WebGL here: pickOnScene and projectRegion are camera maths over a scene
// graph, and only mountColourHead needs a context.
// Symmetric about the origin on purpose: the scene graph holds the file's own
// units, so a model centred anywhere else would project off-centre and say
// nothing about whether the region maths is right.
const PAIR = {
  positions: [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0],
  indices: [0, 1, 2, 1, 3, 2],
};

const mounted = (): LoadedHead => {
  const scene = new Group();
  new Group().add(scene); // the group mountColourHead turns
  return {
    model: buildModel(PAIR.positions, PAIR.indices),
    scene,
    parts: [],
  } as unknown as LoadedHead;
};

const loose = (): LoadedHead =>
  ({
    model: buildModel(PAIR.positions, PAIR.indices),
    scene: new Group(),
    parts: [],
  }) as unknown as LoadedHead;

const SIZE = 200;

describe("pickOnScene", () => {
  // A scene with no parent carries no yaw or pitch, so a ray would meet an
  // unturned head and answer a point the user never clicked.
  it("answers nothing for a head that is not mounted", () => {
    const pick = pickOnScene(loose(), SIZE, SIZE, { yaw: 1, pitch: 0 });
    expect(pick(SIZE / 2, SIZE / 2)).toBeNull();
  });
});

describe("projectRegion", () => {
  const region = { c: [0, 0, 0.5] as [number, number, number], r: 0.2 };

  it("puts a centred region at the middle of the canvas", () => {
    const at = projectRegion(
      mounted(),
      SIZE,
      SIZE,
      { yaw: 0, pitch: 0 },
      region,
    );
    expect(at).not.toBeNull();
    expect(at!.x).toBeCloseTo(SIZE / 2, 3);
    expect(at!.y).toBeCloseTo(SIZE / 2, 3);
    expect(at!.r).toBeGreaterThan(2);
  });

  // Front or back, not near or far: turning the head away has to hide the
  // marker, or it draws through the back of the skull.
  it("hides the marker once the region faces away", () => {
    const head = mounted();
    expect(
      projectRegion(head, SIZE, SIZE, { yaw: 0, pitch: 0 }, region)!.visible,
    ).toBe(true);
    expect(
      projectRegion(head, SIZE, SIZE, { yaw: Math.PI, pitch: 0 }, region)!
        .visible,
    ).toBe(false);
  });

  it("answers nothing for a head that is not mounted", () => {
    expect(
      projectRegion(loose(), SIZE, SIZE, { yaw: 0, pitch: 0 }, region),
    ).toBeNull();
  });
});
