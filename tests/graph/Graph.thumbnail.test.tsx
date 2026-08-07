// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// The stub carries exactly the methods react-force-graph-2d exposes, and no
// others. That is the point of the suite: a parked card's repaint nudge has to
// reach for one of them — refresh() is 3D-only, and calling it here would
// throw a TypeError on every tick of the poll.
const fg = vi.hoisted(() => ({
  zoom: vi.fn((k?: number) => (k === undefined ? 1 : fg)),
  centerAt: vi.fn(),
  zoomToFit: vi.fn(),
  pauseAnimation: vi.fn(),
  resumeAnimation: vi.fn(),
  d3Force: vi.fn((): unknown => undefined),
  d3ReheatSimulation: vi.fn(),
}));
vi.mock("react-force-graph-2d", async () => {
  const { default: React } = await vi.importActual<any>("react");
  return {
    default: React.forwardRef((props: any, ref: any) => {
      if (ref) ref.current = fg;
      return null;
    }),
  };
});

import Graph from "../../src/renderer/graph/Graph";
import { emptyState } from "../../src/renderer/session/highlight-store";
import { defaultSettings, NO_GROUPS } from "../../src/shared/types";
import type { VaultGraph } from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sample: VaultGraph = {
  nodes: [{ id: "a", type: "note" }],
  edges: [],
};
const view = defaultSettings().views["2d"];

const props = () => ({
  graph: sample,
  domains: [] as string[],
  groups: NO_GROUPS,
  display: view.display,
  forces: view.forces,
  stateRef: { current: emptyState() },
  onNodeClick: () => undefined,
  focusNode: null,
  layoutEpoch: 0,
  width: 220,
  height: 130,
});

let root: Root;
let container: HTMLDivElement;
const render = (el: React.ReactElement) => act(() => root.render(el));

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  for (const f of Object.values(fg)) f.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("Graph: the parked card's repaint nudge", () => {
  it("nudges a thumbnail with methods the 2D component actually has", () => {
    const p = props();
    render(<Graph {...(p as any)} thumbnail />);

    p.stateRef.current.rev++;
    act(() => {
      vi.advanceTimersByTime(250);
    });

    // re-set to the value it already had: flips needsRedraw, moves nothing
    expect(fg.zoom).toHaveBeenCalledWith(1);
  });

  it("leaves the open view alone — it repaints every frame already", () => {
    const p = props();
    render(<Graph {...(p as any)} />);

    p.stateRef.current.rev++;
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(fg.zoom).not.toHaveBeenCalled();
  });
});
