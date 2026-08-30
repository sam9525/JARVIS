// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadHead } from "../../src/renderer/voice/load-head";

// The loader is the GLB boundary and wants a DOM plus real bytes, so it is
// replaced with one that hands back a single-triangle scene — enough for
// buildModel, and enough to tell one parse from another by identity.
const gltf = vi.hoisted(() => ({ fail: false }));
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => {
  const geometry = () => {
    const g: any = {
      attributes: { position: { array: [-1, -1, 0, 1, -1, 0, 0, 1, 0] } },
      index: { array: [0, 1, 2] },
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
              fn({ geometry: geometry(), matrixWorld: {} }),
          },
        });
      }
    },
  };
});

describe("loadHead", () => {
  beforeEach(() => {
    gltf.fail = false;
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
