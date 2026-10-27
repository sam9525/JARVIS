// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionScreen from "../../src/renderer/session-screen/SessionScreen";
import type { ScreenItem } from "../../src/renderer/session-screen/screen-state";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let resized: () => void;
let scroller: HTMLDivElement;
let contentHeight: number;
const VIEW = 300;

// jsdom has no layout: the scroller's geometry is driven by hand, and the
// ResizeObserver callback stands in for the content growing.
beforeEach(async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(cb: () => void) {
        resized = cb;
      }
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await show([]);
  scroller = host.querySelector(".overflow-y-auto")!;
  contentHeight = 1000;
  Object.defineProperty(scroller, "scrollHeight", {
    get: () => contentHeight,
  });
  Object.defineProperty(scroller, "clientHeight", { value: VIEW });
  Object.defineProperty(scroller, "scrollTop", {
    value: 0,
    writable: true,
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function show(items: ScreenItem[]): Promise<void> {
  await act(async () => {
    root.render(
      <SessionScreen
        sessionKey="s"
        items={items}
        status={{ kind: "working", call: "" }}
        onAskAnswer={vi.fn()}
        onWrite={vi.fn()}
        onShowRaw={vi.fn()}
        footer={null}
      />,
    );
  });
}

function scrollTo(top: number): void {
  scroller.scrollTop = top;
  scroller.dispatchEvent(new Event("scroll"));
}

function grow(to: number): void {
  contentHeight = to;
  resized();
}

describe("SessionScreen scroll pin", () => {
  it("follows output when a stale scroll event lands after the content grew", () => {
    grow(1000);
    expect(scroller.scrollTop).toBe(1000);
    // the scroll event from that pin is handled once more output is in
    contentHeight = 1500;
    scroller.dispatchEvent(new Event("scroll"));
    grow(1500);
    expect(scroller.scrollTop).toBe(1500);
  });

  it("stays put while the user has scrolled up to read", () => {
    scrollTo(1000 - VIEW);
    scrollTo(400);
    grow(2000);
    expect(scroller.scrollTop).toBe(400);
  });

  it("follows again once the user scrolls back to the bottom", () => {
    scrollTo(1000 - VIEW);
    scrollTo(400);
    grow(2000);
    scrollTo(2000 - VIEW);
    grow(2500);
    expect(scroller.scrollTop).toBe(2500);
  });

  it("jumps to the bottom and follows again when a prompt is sent while scrolled up", async () => {
    const earlier: ScreenItem = { kind: "prompt", id: "p1", text: "first" };
    await show([earlier]);
    scrollTo(1000 - VIEW);
    scrollTo(400);
    contentHeight = 1200;
    await show([earlier, { kind: "prompt", id: "p2", text: "second" }]);
    expect(scroller.scrollTop).toBe(1200);
    grow(1800);
    expect(scroller.scrollTop).toBe(1800);
  });

  it("stays put when Claude's output, not a prompt, arrives while scrolled up", async () => {
    const earlier: ScreenItem = { kind: "prompt", id: "p1", text: "first" };
    await show([earlier]);
    scrollTo(1000 - VIEW);
    scrollTo(400);
    await show([earlier, { kind: "text", id: "t1", markdown: "reply" }]);
    expect(scroller.scrollTop).toBe(400);
  });
});
