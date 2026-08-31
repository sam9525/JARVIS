// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MouthPicker, { radiusFrom } from "../../src/renderer/voice/MouthPicker";
import { loadHead } from "../../src/renderer/voice/load-head";
import {
  mountColourHead,
  pickOnScene,
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

describe("radiusFrom", () => {
  it("grows with the drag distance, in model units", () => {
    const near = radiusFrom([0, 0, 0], [0.1, 0, 0]);
    const far = radiusFrom([0, 0, 0], [0.4, 0, 0]);
    expect(far).toBeGreaterThan(near);
    expect(near).toBeCloseTo(0.1, 6);
  });

  it("never returns zero, so a click without a drag still marks something", () => {
    expect(radiusFrom([0, 0, 0], [0, 0, 0])).toBeGreaterThan(0);
  });
});

describe("MouthPicker", () => {
  it("sends the marked region when Done is pressed", () => {
    let sent: unknown = "unset";
    render(
      <MouthPicker
        initial={{ c: [0, 0.4, 0.9], r: 0.2 }}
        onDone={(r) => {
          sent = r;
        }}
      />,
    );
    screen.getByTestId("mouth-pick-done").props.onClick();
    expect(sent).toEqual({ c: [0, 0.4, 0.9], r: 0.2 });
  });

  it("sends null when Clear is pressed", () => {
    let sent: unknown = "unset";
    render(
      <MouthPicker
        initial={{ c: [0, 0.4, 0.9], r: 0.2 }}
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
  it("marks the raycast hit from a press on the host", async () => {
    const hit: [number, number, number] = [0, 0.4, 0.9];
    const pick = vi.fn(() => hit);
    (loadHead as any).mockResolvedValue({ scene: {}, model: {} });
    (mountColourHead as any).mockReturnValue({
      canvas: document.createElement("canvas"),
      render: () => {},
      dispose: () => {},
    });
    (pickOnScene as any).mockReturnValue(pick);

    let sent: unknown = "unset";
    render(
      <MouthPicker
        onDone={(r) => {
          sent = r;
        }}
      />,
    );
    await act(async () => {});

    const host = container.querySelector(
      '[data-testid="mouth-picker-canvas"]',
    ) as HTMLElement;
    // jsdom implements no pointer capture, and the handler calls it.
    host.setPointerCapture = () => {};
    act(() => {
      host.dispatchEvent(
        new MouseEvent("pointerdown", {
          clientX: 30,
          clientY: 40,
          bubbles: true,
        }),
      );
    });

    // The offsets are the host's own rect, which jsdom reports as the origin.
    expect(pick).toHaveBeenCalledWith(30, 40);
    expect(screen.getByTestId("mouth-pick-done").props.disabled).toBe(false);
    screen.getByTestId("mouth-pick-done").props.onClick();
    expect(sent).toEqual({ c: hit, r: expect.any(Number) });
  });
});
