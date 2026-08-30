// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { hasTexture, loadHead } from "../../src/renderer/voice/load-head";

describe("hasTexture", () => {
  // A scene is walked with traverse, so a plain object with one stands in for
  // the GLTF scene — no three, no WebGL.
  const sceneOf = (...objects: unknown[]) => ({
    traverse: (fn: (o: unknown) => void) => objects.forEach(fn),
  });

  it("finds a colour map on a single material", () => {
    expect(hasTexture(sceneOf({ material: { map: {} } }))).toBe(true);
  });

  it("finds one on a multi-material mesh", () => {
    expect(hasTexture(sceneOf({ material: [{}, { map: {} }] }))).toBe(true);
  });

  it("reports none when no material carries a map", () => {
    expect(hasTexture(sceneOf({ material: {} }, { material: [{}] }, {}))).toBe(
      false,
    );
  });
});

describe("loadHead", () => {
  beforeEach(() => {
    (window as any).jarvis = { readHeadModel: vi.fn() };
  });

  // The colour switch remounts the drawing effect and asks for the same head
  // again. A load that failed must not be the answer it gets — otherwise one
  // bad read costs the head for the rest of the session.
  it("does not remember a failed load", async () => {
    const read = vi
      .fn()
      .mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    (window as any).jarvis.readHeadModel = read;

    await expect(loadHead("broken.glb")).rejects.toBeDefined();
    await expect(loadHead("broken.glb")).rejects.toBeDefined();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
