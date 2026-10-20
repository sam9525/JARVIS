// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const fg = vi.hoisted(() => ({
  zoom: vi.fn((k?: number) => (k === undefined ? 1 : fg)),
  centerAt: vi.fn(),
  zoomToFit: vi.fn(),
  pauseAnimation: vi.fn(),
  resumeAnimation: vi.fn(),
  d3Force: vi.fn((): unknown => undefined),
  d3ReheatSimulation: vi.fn(),
}));
const last = vi.hoisted(() => ({ props: null as any }));
vi.mock("react-force-graph-2d", async () => {
  const { default: React } = await vi.importActual<any>("react");
  return {
    default: React.forwardRef((props: any, ref: any) => {
      if (ref) ref.current = fg;
      last.props = props;
      return null;
    }),
  };
});

import Graph from "../../src/renderer/graph/Graph";
import { emptyState } from "../../src/renderer/session/highlight-store";
import { defaultSettings, NO_GROUPS } from "../../src/shared/types";
import type { VaultGraph } from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const view = defaultSettings().views["2d"];
const stateRef = { current: emptyState() };
const full: VaultGraph = {
  nodes: [
    { id: "a", type: "note" },
    { id: "b", type: "note" },
  ],
  edges: [],
};
const filtered: VaultGraph = { nodes: [full.nodes[0]], edges: [] };

let root: Root;
const show = (graph: VaultGraph) =>
  act(() =>
    root.render(
      <Graph
        graph={graph}
        domains={[]}
        groups={NO_GROUPS}
        display={view.display}
        forces={view.forces}
        stateRef={stateRef}
        onNodeClick={() => undefined}
        focusNode={null}
        layoutEpoch={0}
        width={800}
        height={600}
      />,
    ),
  );
const settle = () => act(() => last.props.onEngineStop());

beforeEach(() => {
  fg.zoomToFit.mockClear();
  act(() => {
    root = createRoot(document.createElement("div"));
  });
});

afterEach(() => act(() => root.unmount()));

describe("Graph: fit to screen", () => {
  it("fits once at launch, and again after a filter changes the graph", () => {
    show(full);
    settle();
    settle(); // a re-settle from a drag must not yank the camera
    expect(fg.zoomToFit).toHaveBeenCalledTimes(1);

    show(filtered);
    settle();
    expect(fg.zoomToFit).toHaveBeenCalledTimes(2);
  });
});
