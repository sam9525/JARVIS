// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// The stand-in Graph paints one canvas and hands its onSettled out, so a test
// decides when the settle and fit have finished.
const live = vi.hoisted(() => ({
  onSettled: undefined as (() => void) | undefined,
}));
vi.mock("../../src/renderer/graph/Graph", async () => {
  const { default: React } = await vi.importActual<any>("react");
  return {
    default: (props: any) => {
      live.onSettled = props.onSettled;
      return React.createElement("canvas", { "data-testid": "live" });
    },
  };
});

import MiniGraph from "../../src/renderer/graph/MiniGraph";
import { snapshots } from "../../src/renderer/graph/card-snapshot";
import { emptyState } from "../../src/renderer/session/highlight-store";
import { defaultSettings } from "../../src/shared/types";
import type { VaultGraph } from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const URL = "data:image/png;base64,AAAA";
const graph: VaultGraph = {
  nodes: [
    { id: "a", type: "note" },
    { id: "b", type: "note" },
  ],
  edges: [{ source: "a", target: "b" }],
};

const props = (over: Record<string, unknown> = {}) => ({
  workspaceId: "w1",
  working: false,
  graph,
  kind: "vault" as const,
  baseHue: 120,
  state: emptyState(),
  groups: [],
  view: defaultSettings().views["2d"],
  filters: {
    sectionFilter: "both" as const,
    showTags: true,
    showOrphans: true,
  },
  width: 220,
  height: 150,
  ...over,
});

let root: Root;
let container: HTMLDivElement;
let toDataURL: ReturnType<typeof vi.spyOn>;
const render = (p: ReturnType<typeof props>) =>
  act(() => root.render(<MiniGraph {...(p as any)} />));
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const settle = () => act(() => live.onSettled?.());
const img = () => container.querySelector("img");
const liveCanvas = () => container.querySelector('[data-testid="live"]');

// renders an idle card and lets it capture, leaving the image on screen
function reachImage(p: ReturnType<typeof props>) {
  render(p);
  settle();
  advance(500);
  expect(img()).not.toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  snapshots.clear();
  live.onSettled = undefined;
  toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue(URL);
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  toDataURL.mockRestore();
  vi.useRealTimers();
});

describe("MiniGraph: live or snapshot", () => {
  it("an idle card captures after it settles and then shows the image", () => {
    render(props());
    expect(liveCanvas()).not.toBeNull();
    settle();
    advance(500);
    const shown = img();
    expect(shown?.getAttribute("src")).toBe(URL);
    expect(shown?.getAttribute("alt")).toBe("");
    expect(shown?.getAttribute("draggable")).toBe("false");
    expect(liveCanvas()).toBeNull();
  });

  it("a working card never captures", () => {
    render(props({ working: true }));
    settle();
    advance(2000);
    expect(liveCanvas()).not.toBeNull();
    expect(img()).toBeNull();
    expect(snapshots.size).toBe(0);
  });

  it("leaving working captures the final highlights", () => {
    const state = emptyState();
    render(props({ working: true, state }));
    settle();
    state.rev = 7;
    render(props({ working: false, state }));
    // the first tick sees the rev move and leaves the canvas a tick to repaint
    advance(500);
    expect(img()).toBeNull();
    advance(500);
    expect(img()).not.toBeNull();
    expect(snapshots.get("w1")?.inputs.rev).toBe(7);
  });

  it("a rev change with no re-render brings the live graph back", () => {
    const state = emptyState();
    reachImage(props({ state }));
    state.rev++;
    advance(500);
    expect(liveCanvas()).not.toBeNull();
    expect(img()).toBeNull();
    // the remounted live graph waits for a settle of its own
    advance(500);
    expect(img()).toBeNull();
    settle();
    advance(500);
    expect(img()).not.toBeNull();
  });

  it("a rev change on a settled live card waits one tick before capturing", () => {
    const state = emptyState();
    state.matchAt = performance.now(); // a match fade keeps the card from capturing
    render(props({ state }));
    settle();
    advance(500);
    expect(img()).toBeNull();
    // ↺: transients clear and the rev moves without a re-render
    state.matchAt = 0;
    state.rev++;
    advance(500);
    expect(img()).toBeNull();
    advance(500);
    expect(img()).not.toBeNull();
    expect(snapshots.get("w1")?.inputs.rev).toBe(state.rev);
  });

  it("a new graph object while live waits for the new settle", () => {
    const state = emptyState();
    render(props({ working: true, state }));
    settle();
    render(props({ working: false, state, graph: { ...graph } }));
    advance(500);
    expect(img()).toBeNull();
    settle();
    advance(500);
    expect(img()).not.toBeNull();
  });

  it("an equal-but-fresh filters object and groups array keep the image", () => {
    const state = emptyState();
    reachImage(props({ state }));
    render(
      props({
        state,
        filters: { sectionFilter: "both", showTags: true, showOrphans: true },
        groups: [],
      }),
    );
    expect(img()).not.toBeNull();
    advance(500);
    expect(img()).not.toBeNull();
  });

  it("a new graph object goes live and waits for the new settle", () => {
    const state = emptyState();
    reachImage(props({ state }));
    render(props({ state, graph: { ...graph } }));
    advance(500);
    expect(liveCanvas()).not.toBeNull();
    expect(img()).toBeNull();
    settle();
    advance(500);
    expect(img()).not.toBeNull();
  });

  it("a failed graph is never captured and drops a stored snapshot", () => {
    const failed: VaultGraph = {
      failed: "x",
      nodes: [{ id: "a", type: "note" }],
      edges: [],
    };
    snapshots.set("w1", {
      url: URL,
      inputs: { graph: failed, rev: 0, look: "" },
    });
    render(props({ graph: failed }));
    expect(snapshots.has("w1")).toBe(false);
    settle();
    advance(1000);
    expect(img()).toBeNull();
  });

  it("unmounting mid-settle captures nothing", () => {
    const consoleError = vi.spyOn(console, "error");
    render(props());
    settle();
    act(() => root.unmount());
    advance(1000);
    expect(snapshots.size).toBe(0);
    expect(toDataURL).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    act(() => {
      root = createRoot(container);
    });
  });
});
