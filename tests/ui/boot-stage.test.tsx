// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  nextStage,
  useBootStage,
  STEP_MS,
  FALLBACK_MS,
} from "../../src/renderer/ui/boot-stage";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("nextStage", () => {
  it("opens a stage when its signal is true", () => {
    expect(STEP_MS).toBe(120);
    expect(FALLBACK_MS).toBe(1200);
    expect(nextStage(-1, [true, false, false, false])).toBe(0);
  });

  it("opens every consecutive stage whose signal is already true", () => {
    expect(nextStage(-1, [true, true, true, true])).toBe(3);
  });

  it("cannot open a stage before the one above it", () => {
    expect(nextStage(-1, [false, true, true, true])).toBe(-1);
    expect(nextStage(0, [true, false, true, true])).toBe(0);
  });

  it("never decreases when a signal flips back to false", () => {
    expect(nextStage(2, [true, false, false, false])).toBe(2);
  });

  it("stops at the end of the list", () => {
    expect(nextStage(3, [true, true, true, true])).toBe(3);
  });
});

// The real React runtime, not the hook-mocking used in the component suites:
// this covers a useState/useEffect timer across renders, which a fake React
// cannot reproduce.
function renderStage(read: () => boolean[]) {
  const box = { current: -2 };
  const container = document.createElement("div");
  let root: Root;
  function Probe() {
    box.current = useBootStage(read());
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
    tick(ms: number) {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

describe("useBootStage", () => {
  afterEach(() => vi.useRealTimers());

  it("starts closed", () => {
    vi.useFakeTimers();
    const r = renderStage(() => [true, true, true, true]);
    expect(r.stage).toBe(-1);
    r.unmount();
  });

  it("opens one stage per STEP_MS when the signals are ready", () => {
    vi.useFakeTimers();
    const r = renderStage(() => [true, true, true, true]);
    r.tick(STEP_MS);
    expect(r.stage).toBe(3);
    r.unmount();
  });

  it("opens a stage when its fallback elapses with the signal still false", () => {
    vi.useFakeTimers();
    const r = renderStage(() => [false, false, false, false]);
    r.tick(STEP_MS);
    expect(r.stage).toBe(-1);
    r.tick(FALLBACK_MS - STEP_MS);
    expect(r.stage).toBe(0);
    r.unmount();
  });

  it("stops scheduling once the last stage is open", () => {
    vi.useFakeTimers();
    const r = renderStage(() => [true, true, true, true]);
    r.tick(STEP_MS);
    expect(r.stage).toBe(3);
    r.tick(FALLBACK_MS * 3);
    expect(r.stage).toBe(3);
    r.unmount();
  });
});
