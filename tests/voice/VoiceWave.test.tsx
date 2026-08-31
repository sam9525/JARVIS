// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Matrix4 } from "three";
import VoiceWave from "../../src/renderer/voice/VoiceWave";
import { buildModel } from "../../src/renderer/voice/head-mesh";
import * as speak from "../../src/renderer/voice/speak";

// The GLB boundary is stubbed: these tests are about the component's loop, and
// GLTFLoader would drag a real file and three's DOM assumptions into jsdom.
const loadHead = vi.hoisted(() => vi.fn());
vi.mock("../../src/renderer/voice/load-head", () => ({ loadHead }));

// The colour renderer is a real WebGL context, which jsdom has none of. The
// stub records the angles it is asked to draw, which is what the loop owes it.
const rendered = vi.hoisted(() => [] as { yaw: number; pitch: number }[]);
const mountColourHead = vi.hoisted(() =>
  vi.fn(() => ({
    render: (yaw: number, pitch: number) => {
      rendered.push({ yaw, pitch });
    },
    dispose: () => undefined,
  })),
);
vi.mock("../../src/renderer/voice/head-render", () => ({ mountColourHead }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// One triangle facing the viewer: three visible edges once it loads.
const TRIANGLE = () => buildModel([-1, -1, 0, 1, -1, 0, 0, 1, 0], [0, 1, 2]);

describe("VoiceWave", () => {
  let root: Root;
  let container: HTMLDivElement;
  const strokes: string[] = [];
  const moves: string[] = [];

  beforeEach(() => {
    strokes.length = 0;
    moves.length = 0;
    loadHead.mockReset();
    loadHead.mockReturnValue(
      new Promise(() => {
        /* the default: a load that never settles */
      }),
    );
    // jsdom has no canvas backend; the component only needs a 2D-ish context
    (HTMLCanvasElement.prototype as any).getContext = () => ({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(() => moves.push("moveTo")),
      lineTo: vi.fn(),
      stroke: vi.fn(() => strokes.push("stroke")),
      set strokeStyle(_v: string) {
        /* colour is not what these tests assert */
      },
      lineWidth: 0,
      lineCap: "",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const silent = () => {
    vi.spyOn(speak, "readWave").mockReturnValue(false);
    vi.spyOn(speak, "isSounding").mockReturnValue(false);
  };

  const flush = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
  };

  it("draws a flat wave before the head model has loaded", () => {
    silent();
    act(() => root.render(<VoiceWave />));
    expect(
      container.querySelector('[data-testid="voice-head"]'),
    ).not.toBeNull();
    expect(strokes.length).toBe(48); // the resting bars, and no head yet
  });

  it("draws the head's visible edges once the model arrives", async () => {
    silent();
    loadHead.mockResolvedValue({
      model: TRIANGLE(),
      scene: {},
      parts: [],
    });
    act(() => root.render(<VoiceWave />));
    await flush();
    // 48 bars, then the whole helmet in one batched path
    expect(moves.length).toBeGreaterThan(48);
  });

  it("keeps drawing the wave when the model fails to load", async () => {
    silent();
    vi.spyOn(console, "error").mockImplementation(() => {
      /* the failure is the point; do not print it */
    });
    loadHead.mockRejectedValue(new Error("404"));
    act(() => root.render(<VoiceWave />));
    await flush();
    expect(strokes.length).toBe(48);
  });

  it("sizes the head to the wave's width, with no label beside it", () => {
    silent();
    act(() => root.render(<VoiceWave />));
    const head = container.querySelector(
      '[data-testid="voice-head"]',
    ) as HTMLCanvasElement;
    const wave = container.querySelector(
      '[data-testid="voice-wave-canvas"]',
    ) as HTMLCanvasElement;
    expect(head.style.width).toBe(wave.style.width);
    expect(head.style.height).toBe("200px");
    expect(container.textContent).toBe("");
  });

  it("wakes the idle loop when the pointer moves, so the head can turn", () => {
    silent();
    act(() => root.render(<VoiceWave />));
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockReturnValue(1 as any);
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 0, clientY: 0 }),
      );
    });
    expect(raf).toHaveBeenCalled();
  });

  it("stops listening to the pointer once unmounted", () => {
    silent();
    act(() => root.render(<VoiceWave />));
    act(() => root.unmount());
    act(() => {
      root = createRoot(container); // afterEach unmounts this one
    });
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockReturnValue(1 as any);
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 10 }),
    );
    expect(raf).not.toHaveBeenCalled();
  });

  it("is transparent to the pointer, so it cannot steal a scrubber click", () => {
    silent();
    act(() => root.render(<VoiceWave />));
    const wave = container.querySelector(
      '[data-testid="voice-wave"]',
    ) as HTMLElement;
    expect(wave.className.split(/\s+/)).toContain("pointer-events-none");
  });

  it("mounts the WebGL canvas in colour mode and the 2D one otherwise", () => {
    silent();
    act(() => root.render(<VoiceWave colour />));
    expect(
      container.querySelector('[data-testid="voice-head-colour"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="voice-head"]')).toBeNull();

    act(() => root.render(<VoiceWave />));
    expect(
      container.querySelector('[data-testid="voice-head"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="voice-head-colour"]'),
    ).toBeNull();
  });

  // A canvas grants one context for its whole life. The colour branch is a
  // host div now, but both branches still sit in the same slot, so without
  // keys React would keep one node and only move the ref — and a wireframe
  // canvas that came back from the colour branch would refuse a 2D context,
  // which is a head that never draws again until the app restarts.
  it("builds a new canvas element when the colour mode flips", () => {
    silent();
    act(() => root.render(<VoiceWave />));
    const wire = container.querySelector('[data-testid="voice-head"]');
    act(() => root.render(<VoiceWave colour />));
    const colour = container.querySelector('[data-testid="voice-head-colour"]');
    expect(wire).not.toBeNull();
    expect(colour).not.toBeNull();
    expect(colour).not.toBe(wire);
    act(() => root.render(<VoiceWave />));
    expect(container.querySelector('[data-testid="voice-head"]')).not.toBe(
      colour,
    );
  });

  it("leaves the rest pose alone while the mouth switch is off", async () => {
    const model = buildModel([-1, -1, 0, 1, -1, 0, 0, 1, 0], [0, 1, 2]);
    loadHead.mockResolvedValue({ model, scene: { children: [] }, parts: [] });
    vi.spyOn(speak, "isSounding").mockReturnValue(true);
    vi.spyOn(speak, "readWave").mockReturnValue(false);
    act(() => root.render(<VoiceWave mouth={false} />));
    await flush();
    expect([...model.pose]).toEqual([...model.verts]);
  });

  it("reports the resolved rig kind to its parent", async () => {
    const model = buildModel([-1, -1, 0, 1, -1, 0, 0, 1, 0], [0, 1, 2]);
    loadHead.mockResolvedValue({ model, scene: { children: [] }, parts: [] });
    let seen: string | null = null;
    act(() =>
      root.render(
        <VoiceWave
          onRig={(k) => {
            seen = k;
          }}
        />,
      ),
    );
    await flush();
    expect(seen).toBe("none"); // an empty scene carries no morph and no bone
  });

  it("turns the colour head toward the pointer", async () => {
    silent();
    rendered.length = 0;
    loadHead.mockResolvedValue({
      model: TRIANGLE(),
      coloured: true,
      scene: { children: [] },
      parts: [],
    });
    act(() => root.render(<VoiceWave colour />));
    await flush();
    const before = rendered.length;
    act(() => {
      window.dispatchEvent(
        new window.MouseEvent("pointermove", {
          clientX: 10,
          clientY: 10,
        }) as unknown as PointerEvent,
      );
    });
    await flush();
    expect(rendered.length).toBeGreaterThan(before);
    const last = rendered[rendered.length - 1];
    expect(Math.abs(last.yaw) + Math.abs(last.pitch)).toBeGreaterThan(0);
  });

  it("opens the mouth from the wave when the switch is on", async () => {
    const model = buildModel([-1, -1, 0, 1, -1, 0, 0, 1, 0], [0, 1, 2]);
    loadHead.mockResolvedValue({ model, scene: { children: [] }, parts: [] });
    vi.spyOn(speak, "isSounding").mockReturnValue(true);
    // a loud buffer, so the peak is well above the resting floor
    vi.spyOn(speak, "readWave").mockImplementation((out: Uint8Array) => {
      out.fill(255);
      return true;
    });
    act(() =>
      root.render(
        <VoiceWave mouth mouthRegion={{ c: [0, 0, 0], w: 10, h: 10, d: 10 }} />,
      ),
    );
    await flush();
    expect([...model.pose]).not.toEqual([...model.verts]);
    // NaN satisfies `not.toEqual` on its own, so a region the mask cannot read
    // would pass the line above while moving nothing.
    expect([...model.pose].every(Number.isFinite)).toBe(true);
  });

  // The mouth on a colour head is the whole feature: that renderer draws the
  // file's own geometry and never reads the CPU model, so the displacement has
  // to be copied into the buffer it does draw.
  it("copies the marked mouth into the drawn geometry in colour mode", async () => {
    const model = TRIANGLE();
    const setXYZ = vi.fn();
    const attr = { setXYZ, needsUpdate: false };
    loadHead.mockResolvedValue({
      model,
      coloured: true,
      scene: { children: [] },
      parts: [
        {
          mesh: { geometry: { attributes: { position: attr } } },
          start: 0,
          count: 3,
          inv: new Matrix4(),
        },
      ],
    });
    vi.spyOn(speak, "isSounding").mockReturnValue(true);
    vi.spyOn(speak, "readWave").mockImplementation((out: Uint8Array) => {
      out.fill(255);
      return true;
    });
    act(() =>
      root.render(
        <VoiceWave
          colour
          mouth
          mouthRegion={{ c: [0, 0, 0], w: 10, h: 10, d: 10 }}
        />,
      ),
    );
    await flush();
    expect(setXYZ).toHaveBeenCalled();
    expect(attr.needsUpdate).toBe(true);
    // Every write lands on a vertex this part owns, in its own local index.
    for (const [at, x, y, z] of setXYZ.mock.calls) {
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(3);
      expect([x, y, z].every(Number.isFinite)).toBe(true);
    }
  });

  it("reports whether the head carries colours of its own", async () => {
    silent();
    loadHead.mockResolvedValue({
      model: TRIANGLE(),
      coloured: false,
      scene: { children: [] },
      parts: [],
    });
    let seen: boolean | null = null;
    act(() =>
      root.render(
        <VoiceWave
          onColoured={(has) => {
            seen = has;
          }}
        />,
      ),
    );
    await flush();
    expect(seen).toBe(false);
  });

  // The setting can outlive the head that earned it, and a grey model in the
  // colour renderer is what the wireframe draws better.
  it("does not mount the colour renderer for a head with no colours", async () => {
    silent();
    mountColourHead.mockClear();
    loadHead.mockResolvedValue({
      model: TRIANGLE(),
      coloured: false,
      scene: { children: [] },
      parts: [],
    });
    act(() => root.render(<VoiceWave colour />));
    await flush();
    expect(mountColourHead).not.toHaveBeenCalled();
  });

  it("reports why a head never drew", async () => {
    silent();
    loadHead.mockRejectedValue(new Error("that head is 4,000,000 triangles"));
    let seen: string | null = null;
    act(() =>
      root.render(
        <VoiceWave
          onHeadError={(why) => {
            seen = why;
          }}
        />,
      ),
    );
    await flush();
    expect(seen).toContain("4,000,000 triangles");
  });

  // A bone writes a rotation and the skin reads matrixWorld, which only a
  // render refreshes. The wireframe never renders, so it has to refresh them
  // itself or the jaw moves in colour mode alone.
  it("refreshes the skinned matrices before reading a bone pose back", async () => {
    const model = TRIANGLE();
    const jaw = { isBone: true, name: "jaw", rotation: { x: 0 } };
    const updateMatrixWorld = vi.fn();
    const skeletonUpdate = vi.fn();
    loadHead.mockResolvedValue({
      model,
      scene: { children: [jaw], updateMatrixWorld },
      parts: [
        {
          mesh: {
            getVertexPosition: (i: number, v: any) => v.set(i, i, i),
            localToWorld: (v: any) => v,
            skeleton: { update: skeletonUpdate },
          },
          start: 0,
          count: 3,
        },
      ],
    });
    vi.spyOn(speak, "isSounding").mockReturnValue(true);
    vi.spyOn(speak, "readWave").mockImplementation((out: Uint8Array) => {
      out.fill(255);
      return true;
    });
    act(() => root.render(<VoiceWave mouth />));
    await flush();
    expect(jaw.rotation.x).toBeGreaterThan(0);
    expect(updateMatrixWorld).toHaveBeenCalledWith(true);
    expect(skeletonUpdate).toHaveBeenCalled();
  });
});
