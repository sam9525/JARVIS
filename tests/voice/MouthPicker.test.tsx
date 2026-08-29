// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MouthPicker, { radiusFrom } from "../../src/renderer/voice/MouthPicker";

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
});
