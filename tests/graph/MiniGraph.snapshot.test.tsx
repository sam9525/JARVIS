// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { CardLayout } from "../../src/shared/types";

// The stand-in Graph paints one canvas, hands its onSettled out and fills the
// layoutRef with a fixed layout, so a test decides when the settle is done.
const live = vi.hoisted(() => ({
  onSettled: undefined as (() => void) | undefined,
  layout: {
    width: 220,
    height: 150,
    transform: { k: 2, x: 0, y: 0 },
    nodes: [
      { id: "a", hk: "a", x: -5, y: 0, r: 4, fill: "#112233" },
      { id: "b", hk: "b", x: 5, y: 0, r: 4, fill: "#112233" },
    ],
    links: [[0, 1]],
  } as CardLayout,
}));
vi.mock("../../src/renderer/graph/Graph", async () => {
  const { default: React } = await vi.importActual<any>("react");
  return {
    default: (props: any) => {
      live.onSettled = props.onSettled;
      if (props.layoutRef) props.layoutRef.current = () => live.layout;
      return React.createElement("canvas", { "data-testid": "live" });
    },
  };
});
const paint = vi.hoisted(() => ({ paintLayout: vi.fn() }));
vi.mock("../../src/renderer/graph/graph-paint", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  paintLayout: paint.paintLayout,
}));

import MiniGraph from "../../src/renderer/graph/MiniGraph";
import { lookKey, snapshots } from "../../src/renderer/graph/card-snapshot";
import { emptyState } from "../../src/renderer/session/highlight-store";
import { defaultSettings } from "../../src/shared/types";
import type { VaultGraph } from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
  onNeedGraph: vi.fn(),
  ...over,
});

const lookOf = (p: ReturnType<typeof props>) =>
  lookKey({
    baseHue: p.baseHue,
    groups: p.groups,
    view: p.view,
    filters: p.filters,
    width: p.width,
    height: p.height,
  });

let root: Root;
let container: HTMLDivElement;
let save: ReturnType<typeof vi.fn>;
let getContext: ReturnType<typeof vi.spyOn>;
const render = (p: ReturnType<typeof props>) =>
  act(() => root.render(<MiniGraph {...(p as any)} />));
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const settle = () => act(() => live.onSettled?.());
const stored = () => container.querySelector('[data-testid="snapshot-w1"]');
const liveCanvas = () => container.querySelector('[data-testid="live"]');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  snapshots.clear();
  live.onSettled = undefined;
  paint.paintLayout.mockClear();
  save = vi.fn().mockResolvedValue(true);
  (window as any).jarvis = { saveCardSnapshot: save };
  getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({} as any);
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  getContext.mockRestore();
  delete (window as any).jarvis;
  vi.useRealTimers();
});

describe("MiniGraph: stored layout or live graph", () => {
  it("a stored snapshot with a matching look draws without a graph", () => {
    const p = props({ graph: null });
    snapshots.set("w1", { look: lookOf(p), layout: live.layout });
    render(p);
    const canvas = stored() as HTMLCanvasElement | null;
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(Math.round(220 * window.devicePixelRatio));
    expect(canvas?.style.width).toBe("220px");
    expect(liveCanvas()).toBeNull();
    expect(p.onNeedGraph).not.toHaveBeenCalled();
    expect(paint.paintLayout).toHaveBeenCalledTimes(1);
    expect(paint.paintLayout.mock.calls[0][1]).toBe(live.layout);
    expect(paint.paintLayout.mock.calls[0][3]).toMatchObject({
      nodeSize: p.view.display.nodeSize * 1.5,
      linkThickness: p.view.display.linkThickness,
    });
  });

  it("a working card with a stored snapshot asks for its graph once", () => {
    const p = props({ graph: null, working: true });
    snapshots.set("w1", { look: lookOf(p), layout: live.layout });
    render(p);
    expect(p.onNeedGraph).toHaveBeenCalledTimes(1);
    expect(stored()).toBeNull();
    // MissionControl hands a fresh callback each render
    const again = vi.fn();
    render({ ...p, onNeedGraph: again });
    advance(1000);
    expect(p.onNeedGraph).toHaveBeenCalledTimes(1);
    expect(again).not.toHaveBeenCalled();
  });

  it("a stored snapshot with another look goes live and saves the new look", () => {
    snapshots.set("w1", { look: "old", layout: live.layout });
    const p = props({ graph: null });
    render(p);
    expect(p.onNeedGraph).toHaveBeenCalledTimes(1);
    expect(stored()).toBeNull();
    render({ ...p, graph });
    expect(liveCanvas()).not.toBeNull();
    settle();
    advance(500);
    expect(save).toHaveBeenCalledWith("w1", {
      look: lookOf(p),
      layout: live.layout,
    });
    expect(p.onNeedGraph).toHaveBeenCalledTimes(1);
  });

  it("an idle live card saves after it settles and then draws the layout", () => {
    const p = props();
    render(p);
    expect(liveCanvas()).not.toBeNull();
    advance(500);
    expect(save).not.toHaveBeenCalled();
    settle();
    advance(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("w1", {
      look: lookOf(p),
      layout: live.layout,
    });
    expect(snapshots.get("w1")).toEqual({
      look: lookOf(p),
      layout: live.layout,
    });
    expect(stored()).not.toBeNull();
    expect(liveCanvas()).toBeNull();
    expect(paint.paintLayout).toHaveBeenCalled();
  });

  it("a working card never saves", () => {
    render(props({ working: true }));
    settle();
    advance(2000);
    expect(liveCanvas()).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(snapshots.size).toBe(0);
  });

  it("a rev change with no re-render repaints the stored layout within a tick", () => {
    const state = emptyState();
    const p = props({ graph: null, state });
    snapshots.set("w1", { look: lookOf(p), layout: live.layout });
    render(p);
    expect(paint.paintLayout).toHaveBeenCalledTimes(1);
    advance(500);
    expect(paint.paintLayout).toHaveBeenCalledTimes(1);
    state.rev++;
    advance(500);
    expect(paint.paintLayout).toHaveBeenCalledTimes(2);
    expect(p.onNeedGraph).not.toHaveBeenCalled();
  });

  it("a fading match repaints on every tick, then once more when it ends", () => {
    let clock = 1100;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    const tick = () => {
      clock += 500;
      advance(500);
    };
    const state = emptyState();
    state.matchAt = 1000;
    const p = props({ graph: null, state });
    snapshots.set("w1", { look: lookOf(p), layout: live.layout });
    render(p);
    expect(paint.paintLayout).toHaveBeenCalledTimes(1);
    // ticks at 1600..3600 all fall inside the 3000 ms fade
    for (let i = 0; i < 5; i++) tick();
    expect(paint.paintLayout).toHaveBeenCalledTimes(6);
    // at 4100 the fade has ended; the ring painted at 3600 is cleared once
    tick();
    expect(paint.paintLayout).toHaveBeenCalledTimes(7);
    tick();
    tick();
    expect(paint.paintLayout).toHaveBeenCalledTimes(7);
    now.mockRestore();
  });

  it("a failed graph is never saved and drops the map entry", () => {
    const failed: VaultGraph = {
      failed: "x",
      nodes: [{ id: "a", type: "note" }],
      edges: [],
    };
    const p = props({ graph: failed });
    snapshots.set("w1", { look: lookOf(p), layout: live.layout });
    render(p);
    expect(snapshots.has("w1")).toBe(false);
    expect(stored()).toBeNull();
    settle();
    advance(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it("unmounting mid-settle saves nothing", () => {
    const consoleError = vi.spyOn(console, "error");
    render(props());
    settle();
    act(() => root.unmount());
    advance(1000);
    expect(snapshots.size).toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    act(() => {
      root = createRoot(container);
    });
  });
});
