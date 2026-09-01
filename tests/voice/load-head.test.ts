// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Matrix4 } from "three";
import { hasColour, loadHead } from "../../src/renderer/voice/load-head";
import { MAX_WIRE_FACES } from "../../src/renderer/voice/head-mesh";

// The loader is the GLB boundary and wants a DOM plus real bytes, so it is
// replaced with one that hands back a single-triangle scene — enough for
// buildModel, and enough to tell one parse from another by identity.
const gltf = vi.hoisted(() => ({ fail: false, tris: 1 }));
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => {
  const geometry = () => {
    const corners = gltf.tris * 3;
    const g: any = {
      attributes: {
        position: {
          array: Array.from({ length: corners * 3 }, (_, i) => i % 3),
        },
      },
      index: { array: Array.from({ length: corners }, (_, i) => i) },
      applyMatrix4: () => g,
      clone: () => g,
      dispose: () => undefined,
    };
    return g;
  };
  return {
    GLTFLoader: class {
      parse(
        _buf: ArrayBuffer,
        _path: string,
        onLoad: (g: unknown) => void,
        onError: (e: Error) => void,
      ) {
        if (gltf.fail) return onError(new Error("bad glb"));
        onLoad({
          scene: {
            updateMatrixWorld: () => undefined,
            traverse: (fn: (o: unknown) => void) =>
              // a real Matrix4: soup inverts it, so the part carries the way
              // back from soup space into this mesh's own vertices
              fn({ geometry: geometry(), matrixWorld: new Matrix4() }),
          },
        });
      }
    },
  };
});

describe("hasColour", () => {
  // A scene is walked with traverse, so a plain object with one stands in for
  // the GLTF scene — no three, no WebGL.
  const sceneOf = (...objects: unknown[]) => ({
    traverse: (fn: (o: unknown) => void) => objects.forEach(fn),
  });
  const white = { getHex: () => 0xffffff };
  const red = { getHex: () => 0xff0000 };

  it("counts a base colour texture", () => {
    expect(hasColour(sceneOf({ material: { map: {}, color: white } }))).toBe(
      true,
    );
  });

  it("counts per-vertex colours", () => {
    expect(hasColour(sceneOf({ material: { vertexColors: true } }))).toBe(true);
  });

  it("counts a material tinted away from white", () => {
    expect(hasColour(sceneOf({ material: { color: red } }))).toBe(true);
  });

  it("finds one anywhere in a multi-material mesh", () => {
    expect(hasColour(sceneOf({ material: [{}, { map: {} }] }))).toBe(true);
  });

  // three gives a primitive with no material a default white one, which is the
  // built-in helmet's case: shading, but nothing a person would call colour.
  it("answers false for plain white materials and none at all", () => {
    expect(
      hasColour(
        sceneOf({ material: { color: white } }, { material: [{}] }, {}),
      ),
    ).toBe(false);
  });

  // A normal or roughness map shapes the light and leaves the model grey.
  it("does not count a map that carries no colour", () => {
    expect(
      hasColour(sceneOf({ material: { normalMap: {}, roughnessMap: {} } })),
    ).toBe(false);
  });
});

describe("loadHead", () => {
  beforeEach(() => {
    gltf.fail = false;
    gltf.tris = 1;
    (window as any).jarvis = { readHeadModel: vi.fn() };
  });

  // The colour switch remounts the drawing effect and asks for the same head
  // again. A load that failed must not be the answer it gets — otherwise one
  // bad read costs the head for the rest of the session.
  it("does not remember a failed load", async () => {
    gltf.fail = true;
    const read = vi
      .fn()
      .mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    (window as any).jarvis.readHeadModel = read;

    await expect(loadHead("broken.glb")).rejects.toBeDefined();
    await expect(loadHead("broken.glb")).rejects.toBeDefined();
    expect(read).toHaveBeenCalledTimes(2);
  });

  // A head denser than the wireframe budget is drawn as a sample of itself,
  // not turned away and not forced into the colour renderer.
  it("loads a head denser than the wireframe budget", async () => {
    gltf.tris = MAX_WIRE_FACES * 2;
    (window as any).jarvis.readHeadModel = vi
      .fn()
      .mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    const head = await loadHead("dense.glb");
    expect(head.model.tri.length).toBe(MAX_WIRE_FACES * 2 * 3);
    expect(head.model.wireFaces.length).toBeLessThanOrEqual(MAX_WIRE_FACES);
    expect(head.model.ea.length).toBeGreaterThan(0);
  });

  // Two renderers must never hold one scene: `Object3D.add` unparents what it
  // is given, so the second mount would steal the head and the first would
  // draw an empty group. `fresh` is what keeps the picker off the wave's copy.
  it("hands a fresh caller its own parse, and caches for everyone else", async () => {
    const read = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    (window as any).jarvis.readHeadModel = read;

    const first = await loadHead("head.glb");
    const shared = await loadHead("head.glb");
    expect(shared.scene).toBe(first.scene);
    expect(read).toHaveBeenCalledTimes(1);

    const own = await loadHead("head.glb", true);
    expect(own.scene).not.toBe(first.scene);
    expect(read).toHaveBeenCalledTimes(2);

    // and the fresh parse does not become the cached one
    expect((await loadHead("head.glb")).scene).toBe(first.scene);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
