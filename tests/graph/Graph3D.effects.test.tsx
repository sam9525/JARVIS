// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// a real ForceGraph3D needs WebGL; these suites are about Graph3D's own
// effects, so the library is a stub that hands a spyable methods object back
// through the ref. Everything Graph3D touches returns undefined so its
// effects bail early — except the methods under test.
const fg = vi.hoisted(() => ({
  refresh: vi.fn(),
  pauseAnimation: vi.fn(),
  resumeAnimation: vi.fn(),
  zoomToFit: vi.fn(),
  cameraPosition: vi.fn(),
  camera: vi.fn((): unknown => undefined),
  scene: vi.fn((): unknown => undefined),
  controls: vi.fn((): unknown => undefined),
  d3Force: vi.fn((): unknown => undefined),
  d3ReheatSimulation: vi.fn(),
}));
vi.mock("react-force-graph-3d", async () => {
  const { default: React } = await vi.importActual<any>("react");
  return {
    default: React.forwardRef((props: any, ref: any) => {
      if (ref) ref.current = fg;
      return null;
    }),
  };
});

import Graph3D from "../../src/renderer/graph/Graph3D";
import { emptyState } from "../../src/renderer/session/highlight-store";
import { defaultSettings, NO_GROUPS } from "../../src/shared/types";
import type { VaultGraph } from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sample: VaultGraph = {
  nodes: [
    { id: "physics/a", type: "note", domain: "physics" },
    { id: "physics/b", type: "note", domain: "physics" },
  ],
  edges: [{ source: "physics/a", target: "physics/b" }],
};

const view = defaultSettings().views["3d"];

// one stable props object per test: the regression under test is that
// UNCHANGED prop identities never refresh()
const props = () => ({
  graph: sample,
  domains: ["physics"],
  groups: NO_GROUPS,
  display: view.display,
  forces: view.forces,
  stateRef: { current: emptyState() },
  onNodeClick: () => undefined,
  focusNode: null,
  layoutEpoch: 0,
  rotationPaused: false,
  width: 800,
  height: 600,
});

let root: Root;
let container: HTMLDivElement;

const render = (el: React.ReactElement) => act(() => root.render(el));

beforeEach(() => {
  // Graph3D runs 250/500ms polling intervals whose first tick calls
  // refresh() regardless of props — fake the timers (but NOT rAF, which the
  // §3 spin test measures) so only prop-identity changes can refresh here
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

describe("Graph3D: the refresh storm (v0.3.5 §5.1)", () => {
  it("a re-render with unchanged props does not call refresh()", () => {
    const p = props();
    render(<Graph3D {...(p as any)} />);
    render(<Graph3D {...(p as any)} />);
    expect(fg.refresh).not.toHaveBeenCalled();
  });

  it("a fresh groups array identity is exactly what forces a refresh", () => {
    const p = props();
    render(<Graph3D {...(p as any)} />);
    render(<Graph3D {...(p as any)} groups={[...NO_GROUPS]} />);
    expect(fg.refresh).toHaveBeenCalledTimes(1);
  });
});
