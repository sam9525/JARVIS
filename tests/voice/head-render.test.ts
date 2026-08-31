// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { BufferAttribute, BufferGeometry, Group, Mesh } from "three";
import {
  mountColourHead,
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

describe("mountColourHead", () => {
  // A canvas whose context was force-lost can never grant a working one again,
  // so a node kept across two mounts kills the second renderer inside three,
  // where it reads a property off a null precision format. The renderer brings
  // its own canvas, and takes it away with it.
  it("brings its own canvas, and removes it when the view cannot open", () => {
    const host = document.createElement("div");
    // jsdom grants no WebGL context, which is the failure a person would
    // otherwise read as "Cannot read properties of null".
    expect(() => mountColourHead(host, new Group(), 10, 10)).toThrow(/WebGL/);
    expect(host.childElementCount).toBe(0);
  });
});

// Two planes facing the camera, one either side of the origin. A ray cast from
// the camera meets the near one; a ray cast from inside the head — which is
// where an un-updated camera matrix puts the origin — meets the far one.
const SANDWICH = (() => {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const z of [1, -1]) {
    const base = positions.length / 3;
    positions.push(-1, -1, z, 1, -1, z, -1, 1, z, 1, 1, z);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return { positions, indices };
})();

const sandwich = (): LoadedHead => {
  const geo = new BufferGeometry();
  geo.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(SANDWICH.positions), 3),
  );
  geo.setIndex(SANDWICH.indices);
  const scene = new Group();
  scene.add(new Mesh(geo));
  new Group().add(scene);
  return {
    model: buildModel(SANDWICH.positions, SANDWICH.indices),
    scene,
    parts: [],
  } as unknown as LoadedHead;
};

describe("pickOnScene", () => {
  // A scene with no parent carries no yaw or pitch, so a ray would meet an
  // unturned head and answer a point the user never clicked.
  it("answers nothing for a head that is not mounted", () => {
    const pick = pickOnScene(loose(), SIZE, SIZE, { yaw: 1, pitch: 0 });
    expect(pick(SIZE / 2, SIZE / 2)).toBeNull();
  });

  // A camera that never updates its world matrix casts from the origin, which
  // is inside the head: every pick lands on the far side, where the marker is
  // culled and the mouth is behind the face.
  it("hits the side of the head that faces the camera", () => {
    const pick = pickOnScene(sandwich(), SIZE, SIZE, { yaw: 0, pitch: 0 });
    const hit = pick(SIZE / 2, SIZE / 2);
    expect(hit).not.toBeNull();
    expect(hit![2]).toBeGreaterThan(0);
  });
});

describe("projectRegion", () => {
  const region = {
    c: [0, 0, 0.5] as [number, number, number],
    w: 0.2,
    h: 0.1,
    d: 0.2,
  };

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
    expect(at!.w).toBeGreaterThan(2);
    // the region is half as tall as it is wide, and the projection says so
    expect(at!.h).toBeLessThan(at!.w);
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
