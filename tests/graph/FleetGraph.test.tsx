// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// this suite is about FleetGraph's hand-action wiring, not the graphs
// themselves — Graph/Graph3D are stubbed out entirely. Graph3D also records
// the `groups` prop it was handed, so the NO_GROUPS identity regression
// (v0.3.5 §5) has a discriminating test at this call site.
const graph3dCalls = vi.hoisted(() => ({ groups: [] as unknown[] }));
vi.mock("../../src/renderer/graph/Graph", () => ({ default: () => null }));
vi.mock("../../src/renderer/graph/Graph3D", () => ({
  default: (props: { groups: unknown }) => {
    graph3dCalls.groups.push(props.groups);
    return null;
  },
}));

import FleetGraph from "../../src/renderer/graph/FleetGraph";
import type { HandActions } from "../../src/renderer/hands/use-hand-actions";
import { defaultSettings } from "../../src/shared/types";
import type { VaultGraph, Workspace } from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ws = (id: string): Workspace => ({
  id,
  name: id,
  rootPath: `D:\\${id}`,
  kind: "code",
  sourceId: "gitnexus",
});

const workspaces = [ws("w1"), ws("w2")];

const graphOf = (...ids: string[]): VaultGraph => ({
  nodes: ids.map((id) => ({ id, type: "note" as const })),
  edges: [],
});

let root: Root;
let container: HTMLDivElement;

function render(el: React.ReactElement) {
  act(() => root.render(el));
}

const props = (over: Partial<Record<string, unknown>> = {}) => ({
  workspaces,
  graphs: new Map<string, VaultGraph>([
    ["w1", graphOf("a.ts")],
    ["w2", graphOf("b.ts")],
  ]),
  view: defaultSettings().views["3d"],
  dimensions: "3d",
  layoutEpoch: 0,
  width: 900,
  height: 600,
  actionsRef: { current: {} as HandActions },
  onOpen: () => undefined,
  ...over,
});

beforeEach(() => {
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

describe("FleetGraph: hand actions", () => {
  it("registers orbit/zoom in 3D and drag/zoom in 2D", () => {
    const actionsRef = { current: {} as HandActions };
    render(
      <FleetGraph {...(props({ dimensions: "3d", actionsRef }) as any)} />,
    );
    expect(actionsRef.current.orbit).toBeDefined();
    expect(actionsRef.current.zoom).toBeDefined();
    expect(actionsRef.current.drag).toBeUndefined();

    const actionsRef2 = { current: {} as HandActions };
    render(
      <FleetGraph
        {...(props({ dimensions: "2d", actionsRef: actionsRef2 }) as any)}
      />,
    );
    expect(actionsRef2.current.drag).toBeDefined();
    expect(actionsRef2.current.zoom).toBeDefined();
    expect(actionsRef2.current.orbit).toBeUndefined();
  });

  it("clears the map on unmount", () => {
    const actionsRef = { current: {} as HandActions };
    render(<FleetGraph {...(props({ actionsRef }) as any)} />);
    render(<div />);
    expect(actionsRef.current.orbit).toBeUndefined();
  });
});

describe("FleetGraph: groups identity (v0.3.5 §5 regression)", () => {
  it("passes the same groups reference to Graph3D across renders", () => {
    graph3dCalls.groups.length = 0;
    render(<FleetGraph {...(props() as any)} />);
    render(<FleetGraph {...(props() as any)} />);
    expect(graph3dCalls.groups.length).toBe(2);
    expect(graph3dCalls.groups[0]).toBe(graph3dCalls.groups[1]);
  });
});
