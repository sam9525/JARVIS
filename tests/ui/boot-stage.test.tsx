// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  useBootStage,
  runMs,
  ENTER_MS,
  LIST_STEP_MS,
  FALLBACK_MS,
} from "../../src/renderer/ui/boot-stage";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("runMs", () => {
  it("is one entrance for a lone item", () => {
    expect(runMs(1)).toBe(ENTER_MS);
    expect(runMs(0)).toBe(ENTER_MS);
  });

  it("adds a step per extra item, ending when the last one finishes", () => {
    expect(runMs(6)).toBe(5 * LIST_STEP_MS + ENTER_MS);
  });
});

/**
 * The real React runtime, not the hook-mocking used in the component suites:
 * this covers a useState/useEffect timer across renders, which a fake React
 * cannot reproduce. `read` is called on every render, so mutating the array it
 * closes over and then calling `rerender` is how a signal turns true.
 */
function renderStage(read: () => boolean[], holds: number[]) {
  const box = { current: -2 };
  const container = document.createElement("div");
  let root: Root;
  function Probe() {
    box.current = useBootStage(read(), holds);
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });
  return {
    get stage() {
      return box.current;
    },
    // one act per tick, so React flushes the state update and re-arms the next
    // timer before the following tick advances into it
    tick(ms: number) {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    },
    rerender() {
      act(() => {
        root.render(<Probe />);
      });
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

const ALL_TRUE = () => [true, true, true, true];

describe("useBootStage", () => {
  afterEach(() => vi.useRealTimers());

  it("starts closed", () => {
    vi.useFakeTimers();
    const r = renderStage(ALL_TRUE, [ENTER_MS, ENTER_MS, ENTER_MS]);
    expect(r.stage).toBe(-1);
    r.unmount();
  });

  it("opens stage 0 as soon as its signal lands — nothing is animating yet", () => {
    vi.useFakeTimers();
    const r = renderStage(ALL_TRUE, [ENTER_MS, ENTER_MS, ENTER_MS]);
    r.tick(1);
    expect(r.stage).toBe(0);
    r.unmount();
  });

  // the point of the whole hook: a stage never starts over one still moving
  it("holds each stage for the run the one before it started", () => {
    vi.useFakeTimers();
    const railRun = runMs(6); // 620 ms
    const r = renderStage(ALL_TRUE, [ENTER_MS, railRun, ENTER_MS]);
    r.tick(1);
    expect(r.stage).toBe(0);

    r.tick(ENTER_MS - 1);
    expect(r.stage).toBe(0); // stage 0's own entrance is still running
    r.tick(1);
    expect(r.stage).toBe(1);

    r.tick(railRun - 1);
    expect(r.stage).toBe(1); // all six rail buttons must finish first
    r.tick(1);
    expect(r.stage).toBe(2);
    r.unmount();
  });

  it("opens a stage when its fallback elapses with the signal still false", () => {
    vi.useFakeTimers();
    const r = renderStage(
      () => [false, false, false, false],
      [ENTER_MS, ENTER_MS, ENTER_MS],
    );
    r.tick(FALLBACK_MS - 1);
    expect(r.stage).toBe(-1);
    r.tick(1);
    expect(r.stage).toBe(0);
    r.unmount();
  });

  it("never lets the fallback cut a longer run short", () => {
    vi.useFakeTimers();
    const longRun = runMs(40); // 2660 ms, well past FALLBACK_MS
    const r = renderStage(() => [true, false, false, false], [longRun]);
    r.tick(1);
    expect(r.stage).toBe(0);
    r.tick(FALLBACK_MS);
    expect(r.stage).toBe(0);
    r.tick(longRun - FALLBACK_MS);
    expect(r.stage).toBe(1);
    r.unmount();
  });

  it("cannot open a stage before the one above it", () => {
    vi.useFakeTimers();
    // stage 0's signal never arrives, so stage 1 waits out 0's fallback first
    const r = renderStage(
      () => [false, true, true, true],
      [ENTER_MS, ENTER_MS, ENTER_MS],
    );
    r.tick(ENTER_MS);
    expect(r.stage).toBe(-1);
    r.tick(FALLBACK_MS);
    expect(r.stage).toBe(0);
    r.tick(ENTER_MS);
    expect(r.stage).toBe(1);
    r.unmount();
  });

  it("drops to the hold when a waited-for signal turns true", () => {
    vi.useFakeTimers();
    const signals = [false, false, false, false];
    const r = renderStage(() => [...signals], [ENTER_MS, ENTER_MS, ENTER_MS]);
    r.tick(ENTER_MS);
    expect(r.stage).toBe(-1); // still serving the stall backstop
    signals[0] = true;
    r.rerender();
    r.tick(1);
    expect(r.stage).toBe(0);
    r.unmount();
  });

  it("never closes a stage whose signal flips back to false", () => {
    vi.useFakeTimers();
    const signals = [true, true, false, false];
    const r = renderStage(() => [...signals], [ENTER_MS, ENTER_MS, ENTER_MS]);
    r.tick(1);
    r.tick(ENTER_MS);
    expect(r.stage).toBe(1);
    signals[0] = false;
    signals[1] = false;
    r.rerender();
    expect(r.stage).toBe(1);
    r.tick(ENTER_MS);
    expect(r.stage).toBe(1); // 2's signal is false, so only its backstop moves it
    r.unmount();
  });

  // the holds are timers, not animations, so cancelling the animations alone
  // would leave a near-empty window behind boot-hold for a second or two — and
  // out of the focus order and the accessibility tree while it waited
  it("opens everything at once under prefers-reduced-motion", () => {
    vi.useFakeTimers();
    // jsdom ships no matchMedia at all, which is why the hook guards on
    // `typeof matchMedia === "function"` before calling it
    (globalThis as any).matchMedia = () => ({ matches: true });
    const r = renderStage(
      () => [false, false, false, false],
      [ENTER_MS, ENTER_MS, ENTER_MS],
    );
    expect(r.stage).toBe(3); // no wait, and no signal needed
    r.tick(FALLBACK_MS * 2);
    expect(r.stage).toBe(3);
    r.unmount();
    delete (globalThis as any).matchMedia;
  });

  it("runs the sequence where matchMedia does not exist", () => {
    vi.useFakeTimers();
    expect((globalThis as any).matchMedia).toBeUndefined();
    const r = renderStage(ALL_TRUE, [ENTER_MS, ENTER_MS, ENTER_MS]);
    expect(r.stage).toBe(-1);
    r.tick(1);
    expect(r.stage).toBe(0);
    r.unmount();
  });

  it("stops scheduling once the last stage is open", () => {
    vi.useFakeTimers();
    const r = renderStage(ALL_TRUE, [ENTER_MS, ENTER_MS, ENTER_MS]);
    r.tick(1);
    for (let i = 0; i < 3; i++) r.tick(ENTER_MS);
    expect(r.stage).toBe(3);
    r.tick(FALLBACK_MS * 3);
    expect(r.stage).toBe(3);
    r.unmount();
  });
});
