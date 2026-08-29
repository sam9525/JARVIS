// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import VoiceWave from "../../src/renderer/voice/VoiceWave";
import { buildModel } from "../../src/renderer/voice/head-mesh";
import * as speak from "../../src/renderer/voice/speak";

// The GLB boundary is stubbed: these tests are about the component's loop, and
// GLTFLoader would drag a real file and three's DOM assumptions into jsdom.
const loadHead = vi.hoisted(() => vi.fn());
vi.mock("../../src/renderer/voice/load-head", () => ({ loadHead }));

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
      root.render(<VoiceWave mouth mouthRegion={{ c: [0, 0, 0], r: 10 }} />),
    );
    await flush();
    expect([...model.pose]).not.toEqual([...model.verts]);
  });
});
