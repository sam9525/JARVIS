/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

// captured so a test can run an effect and invoke its cleanup — the unmount
// disposal is the whole point of the no-op-dispose dance
const h = vi.hoisted(() => ({ effects: [] as any[] }));

vi.mock("react", async () => {
  const actual = (await vi.importActual("react")) as any;
  return {
    ...actual,
    useRef: (initial: any) => ({ current: initial }),
    useCallback: (fn: any) => fn,
    useEffect: (fn: any) => {
      h.effects.push(fn);
    },
  };
});

const noop = () => {
  return;
};

// makeGlowTexture/makeRingTexture paint into a real 2D context; stub just the
// calls they make
(global as any).document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop: noop }),
      fillRect: noop,
      beginPath: noop,
      arc: noop,
      stroke: noop,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
    }),
  }),
};

const load = async () => {
  const three = await import("three");
  const { useSpriteMaterials } =
    await import("../../src/renderer/graph/sprite-materials");
  return { three, useSpriteMaterials };
};

beforeEach(() => {
  h.effects.length = 0;
});

describe("useSpriteMaterials", () => {
  it("caches one material per colour so refresh() doesn't rebuild them", async () => {
    const { useSpriteMaterials } = await load();
    const m = useSpriteMaterials(false, 0.5);
    expect(m.glow("#ff0000")).toBe(m.glow("#ff0000"));
    expect(m.glow("#ff0000")).not.toBe(m.glow("#00ff00"));
    expect(m.ring("#ff0000")).toBe(m.ring("#ff0000"));
    // glow and ring are different sprites even at the same colour
    expect(m.glow("#ff0000")).not.toBe(m.ring("#ff0000"));
  });

  it("shares one texture across every colour of a kind", async () => {
    const { useSpriteMaterials } = await load();
    const m = useSpriteMaterials(false, 0.5);
    expect(m.glow("#ff0000").map).toBe(m.glow("#00ff00").map);
    expect(m.ring("#ff0000").map).toBe(m.ring("#00ff00").map);
  });

  it("neuters dispose so the library's flush can't free a shared material", async () => {
    const { three, useSpriteMaterials } = await load();
    const m = useSpriteMaterials(false, 0.5);
    const glow = m.glow("#ff0000");
    expect(glow.dispose).not.toBe(three.SpriteMaterial.prototype.dispose);
    expect(() => glow.dispose()).not.toThrow(); // a refresh() disposal is a no-op
    expect(m.glow("#ff0000")).toBe(glow); // still cached and usable
  });

  it("additively blends glows normally, but layers them in lite mode", async () => {
    const { three, useSpriteMaterials } = await load();
    expect(useSpriteMaterials(false, 1).glow("#fff").blending).toBe(
      three.AdditiveBlending,
    );
    // a dense fleet saturates toward white under additive blending
    expect(useSpriteMaterials(true, 1).glow("#fff").blending).toBe(
      three.NormalBlending,
    );
  });

  it("builds glows at the opacity of the current render", async () => {
    const { useSpriteMaterials } = await load();
    expect(useSpriteMaterials(false, 0.25).glow("#ff0000").opacity).toBe(0.25);
    expect(useSpriteMaterials(false, 0.8).glow("#ff0000").opacity).toBe(0.8);
  });

  it("re-tints every live glow when the opacity slider moves", async () => {
    const { useSpriteMaterials } = await load();
    const m = useSpriteMaterials(false, 0.25);
    const red = m.glow("#ff0000");
    const green = m.glow("#00ff00");

    m.setGlowOpacity(0.9);
    expect(red.opacity).toBe(0.9);
    expect(green.opacity).toBe(0.9);
    // rings are not opacity-driven — the slider must leave them alone
    expect(m.ring("#ff0000").opacity).toBe(1);
  });

  it("really disposes materials and textures on unmount", async () => {
    const { three, useSpriteMaterials } = await load();
    const m = useSpriteMaterials(false, 1);
    const glow = m.glow("#ff0000");
    const ring = m.ring("#00ff00");
    const disposed: object[] = [];
    const spy = vi
      .spyOn(three.SpriteMaterial.prototype, "dispose")
      .mockImplementation(function (this: object) {
        disposed.push(this);
      });
    const texSpy = vi
      .spyOn(three.Texture.prototype, "dispose")
      .mockImplementation(function (this: object) {
        disposed.push(this);
      });

    // run the registered effect, then its cleanup — i.e. mount then unmount
    const cleanup = h.effects[h.effects.length - 1]();
    cleanup();

    expect(disposed).toContain(glow);
    expect(disposed).toContain(ring);
    expect(disposed).toContain(glow.map);
    expect(disposed).toContain(ring.map);
    spy.mockRestore();
    texSpy.mockRestore();
  });
});

// radii in sphere radii: 1 is the sphere's own silhouette
describe("3D ring layout", () => {
  it("draws the modified ring clear of the sphere", async () => {
    const { RING_SCALE, ringBand } =
      await import("../../src/renderer/graph/sprite-materials");
    const [inner] = ringBand(RING_SCALE.modified);
    expect(inner).toBeGreaterThanOrEqual(1.15);
  });

  it("puts the read ring outside the modified ring when a node wears both", async () => {
    const { RING_SCALE, ringBand } =
      await import("../../src/renderer/graph/sprite-materials");
    const [, modifiedOuter] = ringBand(RING_SCALE.modified);
    const [readInner] = ringBand(RING_SCALE.readOutsideModified);
    expect(readInner - modifiedOuter).toBeGreaterThanOrEqual(0.1);
  });
});
