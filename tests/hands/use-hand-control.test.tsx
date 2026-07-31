// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const tracker = vi.hoisted(() => ({
  frameCb: null as null | ((f: { hand: unknown; t: number }) => void),
  stop: vi.fn(),
  starts: 0,
  impl: null as null | (() => Promise<() => void>),
}));
vi.mock("../../src/renderer/hands/hand-tracker", () => ({
  startHandTracker: (cb: (f: { hand: unknown; t: number }) => void) => {
    tracker.frameCb = cb;
    tracker.starts++;
    return tracker.impl
      ? tracker.impl()
      : Promise.reject(new Error("No camera available"));
  },
}));

import { useHandControl } from "../../src/renderer/hands/use-hand-control";
import type { HandActions } from "../../src/renderer/hands/use-hand-actions";
import { fistHand, palmHand, pinchedHand } from "./hands";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function Host({
  cameraOn,
  actionsRef,
  onFail,
}: {
  cameraOn: boolean;
  actionsRef: React.MutableRefObject<HandActions>;
  onFail: () => void;
}) {
  const h = useHandControl({ cameraOn, actionsRef, onCameraFailed: onFail });
  return (
    <div
      data-testid="probe"
      data-armed={String(h.armed)}
      data-error={h.error ?? ""}
    />
  );
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  tracker.frameCb = null;
  tracker.stop.mockClear();
  tracker.starts = 0;
  tracker.impl = null;
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
const flush = () => act(async () => Promise.resolve());
const probe = () =>
  container.querySelector('[data-testid="probe"]') as HTMLElement;
const feed = (hand: unknown, t: number) =>
  act(() => tracker.frameCb!({ hand, t }));
const disarmByFist = () => {
  feed(fistHand(), 0);
  feed(fistHand(), 0.6);
  feed(fistHand(), 1.1);
};

describe("useHandControl", () => {
  const actionsRef = { current: {} as HandActions };
  const host = (cameraOn: boolean, onFail = () => undefined) => (
    <Host cameraOn={cameraOn} actionsRef={actionsRef} onFail={onFail} />
  );

  it("camera off starts nothing", async () => {
    render(host(false));
    await flush();
    expect(tracker.starts).toBe(0);
  });

  it("camera on starts the tracker armed", async () => {
    tracker.impl = () => Promise.resolve(tracker.stop);
    render(host(true));
    await flush();
    expect(tracker.starts).toBe(1);
    expect(probe().getAttribute("data-armed")).toBe("true");
  });

  it("a held fist disarms without stopping the camera; a disarmed engine drops everything except arm", async () => {
    tracker.impl = () => Promise.resolve(tracker.stop);
    const drag = vi.fn();
    actionsRef.current = { drag };
    render(host(true));
    await flush();
    disarmByFist();
    expect(probe().getAttribute("data-armed")).toBe("false");
    expect(tracker.stop).not.toHaveBeenCalled(); // camera keeps running
    feed(pinchedHand(0.3), 2);
    feed(pinchedHand(0.5), 2.1);
    expect(drag).not.toHaveBeenCalled(); // dropped while disarmed
    feed(palmHand(), 3); // held palm re-arms
    feed(palmHand(), 4.1);
    expect(probe().getAttribute("data-armed")).toBe("true");
    expect(tracker.starts).toBe(1); // arming never restarts the camera
    feed(pinchedHand(0.3), 5);
    feed(pinchedHand(0.5), 5.1);
    expect(drag).toHaveBeenCalled();
  });

  it("armed resets to true on every camera start", async () => {
    tracker.impl = () => Promise.resolve(tracker.stop);
    render(host(true));
    await flush();
    disarmByFist();
    render(host(false)); // camera off
    await flush();
    render(host(true)); // back on — must start armed
    await flush();
    expect(tracker.starts).toBe(2);
    expect(probe().getAttribute("data-armed")).toBe("true");
  });

  it("a tracker failure reports and calls onCameraFailed", async () => {
    const onFail = vi.fn();
    render(host(true, onFail));
    await flush();
    expect(onFail).toHaveBeenCalled();
    expect(probe().getAttribute("data-error")).toContain("No camera available");
  });

  it("camera off stops the tracker", async () => {
    tracker.impl = () => Promise.resolve(tracker.stop);
    render(host(true));
    await flush();
    render(host(false));
    expect(tracker.stop).toHaveBeenCalled();
  });
});
