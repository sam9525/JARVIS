// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MouthPicker from "../../src/renderer/voice/MouthPicker";
import { loadHead } from "../../src/renderer/voice/load-head";
import {
  mountColourHead,
  pickOnScene,
  projectRegion,
} from "../../src/renderer/voice/head-render";

vi.mock("../../src/renderer/voice/load-head", () => ({
  loadHead: vi.fn(),
}));

vi.mock("../../src/renderer/voice/head-render", () => ({
  mountColourHead: vi.fn(),
  pickOnScene: vi.fn(),
  projectRegion: vi.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  // jsdom has no canvas backend, and the picker's effect bails without a 2D
  // context — which takes the pointer listeners with it.
  (HTMLCanvasElement.prototype as any).getContext = () => ({
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    stroke: () => {},
    fill: () => {},
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
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
});

const render = (el: React.ReactElement) => act(() => root.render(el));

const screen = {
  getByTestId(testId: string) {
    const el = container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement;
    if (!el) throw new Error(`Element with data-testid="${testId}" not found`);
    return {
      className: el.className,
      props: {
        disabled: (el as HTMLButtonElement).disabled,
        onClick: () => act(() => el.click()),
      },
    };
  },
};

describe("MouthPicker", () => {
  it("sends the marked region when Done is pressed", () => {
    let sent: unknown = "unset";
    render(
      <MouthPicker
        initial={{ c: [0, 0.4, 0.9], w: 0.2, h: 0.1, d: 0.2 }}
        onDone={(r) => {
          sent = r;
        }}
      />,
    );
    screen.getByTestId("mouth-pick-done").props.onClick();
    expect(sent).toEqual({ c: [0, 0.4, 0.9], w: 0.2, h: 0.1, d: 0.2 });
  });

  it("sends null when Clear is pressed", () => {
    let sent: unknown = "unset";
    render(
      <MouthPicker
        initial={{ c: [0, 0.4, 0.9], w: 0.2, h: 0.1, d: 0.2 }}
        onDone={(r) => {
          sent = r;
        }}
      />,
    );
    screen.getByTestId("mouth-pick-clear").props.onClick();
    expect(sent).toBeNull();
  });

  it("disables Done until something is marked", () => {
    render(<MouthPicker onDone={() => {}} />);
    expect(screen.getByTestId("mouth-pick-done").props.disabled).toBe(true);
  });

  // The pointer path moved off the canvas when the renderer took ownership of
  // its own: the listeners, the capture and the rect all read the host div
  // now. A div that stops receiving these is a picker that cannot pick.
  const mountHead = (hit: [number, number, number] | null) => {
    const pick = vi.fn(() => hit);
    (loadHead as any).mockResolvedValue({ scene: {}, model: {} });
    (mountColourHead as any).mockReturnValue({
      canvas: document.createElement("canvas"),
      render: () => {},
      dispose: () => {},
    });
    (pickOnScene as any).mockReturnValue(pick);
    return pick;
  };

  const host = () => {
    const el = container.querySelector(
      '[data-testid="mouth-picker-canvas"]',
    ) as HTMLElement;
    // jsdom implements no pointer capture, and the handler calls it.
    el.setPointerCapture = () => {};
    return el;
  };

  const pointer = (el: HTMLElement, type: string, x: number, y: number) =>
    act(() => {
      el.dispatchEvent(
        new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }),
      );
    });

  it("marks the raycast hit from a click on the host", async () => {
    const hit: [number, number, number] = [0, 0.4, 0.9];
    const pick = mountHead(hit);

    let sent: unknown = "unset";
    render(
      <MouthPicker
        onDone={(r) => {
          sent = r;
        }}
      />,
    );
    await act(async () => {});

    const el = host();
    pointer(el, "pointerdown", 30, 40);
    pointer(el, "pointerup", 30, 40);

    // The offsets are the host's own rect, which jsdom reports as the origin.
    expect(pick).toHaveBeenCalledWith(30, 40);
    expect(screen.getByTestId("mouth-pick-done").props.disabled).toBe(false);
    screen.getByTestId("mouth-pick-done").props.onClick();
    expect(sent).toEqual({
      c: hit,
      w: expect.any(Number),
      h: expect.any(Number),
      d: expect.any(Number),
    });
  });

  // The two used to share the press, so turning the head moved the mouth.
  it("turns the head on a drag without marking anything", async () => {
    const pick = mountHead([0, 0.4, 0.9]);
    render(<MouthPicker onDone={() => {}} />);
    await act(async () => {});

    const el = host();
    pointer(el, "pointerdown", 30, 40);
    pointer(el, "pointermove", 90, 60);
    pointer(el, "pointerup", 90, 60);

    expect(pick).not.toHaveBeenCalled();
    expect(screen.getByTestId("mouth-pick-done").props.disabled).toBe(true);
  });

  // The resize used to measure from the box centre, so a press anywhere but
  // the exact corner snapped the box shut on the first pixel of movement.
  it("grows the box from where the drag grabbed it", async () => {
    mountHead([0, 0.4, 0.9]);
    (projectRegion as any).mockReturnValue({
      x: 100,
      y: 100,
      w: 20,
      h: 10,
      visible: true,
    });

    let sent: any = null;
    render(
      <MouthPicker
        initial={{ c: [0, 0.4, 0.9], w: 0.16, h: 0.06, d: 0.16 }}
        onDone={(r) => {
          sent = r;
        }}
      />,
    );
    await act(async () => {});

    const el = host();
    // well inside the box, not on its corner
    pointer(el, "pointerdown", 105, 102);
    pointer(el, "pointermove", 125, 102);
    pointer(el, "pointerup", 125, 102);

    screen.getByTestId("mouth-pick-done").props.onClick();
    // 20px further out at 0.16/20 model units a pixel, and a height the drag
    // never touched — not the MIN_HALF the old maths collapsed it to.
    expect(sent.w).toBeCloseTo(0.32, 5);
    expect(sent.h).toBeCloseTo(0.06, 5);
  });
});
