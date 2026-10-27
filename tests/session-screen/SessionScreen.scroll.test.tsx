// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionScreen from "../../src/renderer/session-screen/SessionScreen";

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
  await act(async () => {
    root.render(
      <SessionScreen
        sessionKey="s"
        items={[]}
        status={{ kind: "working", call: "" }}
        onAskAnswer={vi.fn()}
        onWrite={vi.fn()}
        onShowRaw={vi.fn()}
        footer={null}
      />,
    );
  });
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
});
