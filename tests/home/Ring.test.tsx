// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// the centre graph is WebGL; this suite is about the ring around it. The spy
// records every render's props so the debounce tests can see what mounted.
const graph3d = vi.hoisted(() => vi.fn());
vi.mock("../../src/renderer/graph/Graph3D", () => ({
  default: (props: any) => {
    graph3d(props);
    return null;
  },
}));

import Ring from "../../src/renderer/home/Ring";
import type { HandActions } from "../../src/renderer/hands/use-hand-actions";
import { emptyState } from "../../src/renderer/session/highlight-store";
import { defaultSettings } from "../../src/shared/types";
import type {
  VaultGraph,
  Workspace,
  WorkspaceStatus,
} from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ws = (
  id: string,
  kind: Workspace["kind"],
  sourceId: string,
): Workspace => ({ id, name: id, rootPath: `D:\\${id}`, kind, sourceId });

const workspaces = [
  ws("w1", "vault", "vault"),
  ws("w2", "code", "gitnexus"),
  ws("w3", "code", "graphify"),
];

const status = (over: Partial<WorkspaceStatus>): WorkspaceStatus => ({
  workspaceId: "w1",
  kind: "idle",
  call: "",
  since: 0,
  reads: 0,
  edits: 0,
  ...over,
});

const graphOf = (...ids: string[]): VaultGraph => ({
  nodes: ids.map((id) => ({ id, type: "note" as const })),
  edges: [],
});

let root: Root;
let container: HTMLDivElement;

function render(el: React.ReactElement) {
  act(() => root.render(el));
}

const byTestId = (id: string) =>
  container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

const props = (over: Partial<Record<string, unknown>> = {}) => ({
  workspaces,
  statuses: [] as WorkspaceStatus[],
  graphs: new Map<string, VaultGraph>([
    ["w1", graphOf("a")],
    ["w2", graphOf("b.ts")],
    ["w3", graphOf("c.ts")],
  ]),
  getStore: () => emptyState(),
  groups: {},
  view: defaultSettings().views["3d"],
  filters: { sectionFilter: "both", showTags: true, showOrphans: true },
  width: 900,
  height: 600,
  indexing: {},
  layoutEpoch: 0,
  actionsRef: { current: {} as HandActions },
  onIndex: () => undefined,
  onOpen: () => undefined,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  graph3d.mockClear();
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

// flush the tile entrance (500 ms + stagger), the settle debounce (300 ms)
// and the wheel-snap timer (200 ms)
const settle = () =>
  act(() => {
    vi.advanceTimersByTime(1000);
  });

const wheel = (deltaY: number) =>
  act(() => {
    byTestId("ring")!.dispatchEvent(
      new WheelEvent("wheel", { deltaY, bubbles: true }),
    );
  });

describe("Ring", () => {
  it("renders a tile per workspace with name, source caption and counts", () => {
    render(
      <Ring
        {...(props({
          statuses: [status({ workspaceId: "w2", reads: 8, edits: 2 })],
        }) as any)}
      />,
    );
    expect(byTestId("tile-w1")!.textContent).toContain("w1");
    expect(byTestId("tile-source-w2")!.textContent).toBe("GitNexus");
    expect(byTestId("tile-source-w3")!.textContent).toBe("Graphify");
    const counts = byTestId("tile-counts-w2")!.textContent!;
    expect(counts).toContain("8");
    expect(counts).toContain("2");
  });

  it("carries the untruncated call in a native tooltip on the tile caption", () => {
    const call =
      "Bash(npx vitest run tests/home/Ring.test.tsx --reporter verbose)";
    render(
      <Ring
        {...(props({
          statuses: [status({ workspaceId: "w1", kind: "working", call })],
        }) as any)}
      />,
    );
    expect(byTestId("tile-call-w1")!.getAttribute("title")).toBe(call);
  });

  it("starts with the first workspace centred", () => {
    render(<Ring {...(props() as any)} />);
    expect(byTestId("tile-w1")!.hasAttribute("data-centered")).toBe(true);
    expect(byTestId("tile-w2")!.hasAttribute("data-centered")).toBe(false);
  });

  it("opens the centred tile on click", () => {
    const onOpen = vi.fn();
    render(<Ring {...(props({ onOpen }) as any)} />);
    act(() => byTestId("tile-w1")!.click());
    expect(onOpen).toHaveBeenCalledWith(workspaces[0]);
  });

  it("rotates a non-centred tile to centre instead of opening it", () => {
    const onOpen = vi.fn();
    render(<Ring {...(props({ onOpen }) as any)} />);
    act(() => byTestId("tile-w2")!.click());
    expect(onOpen).not.toHaveBeenCalled();
    expect(byTestId("tile-w2")!.hasAttribute("data-centered")).toBe(true);
  });

  it("loads no centre graph until rotation has settled for ~300 ms", () => {
    render(<Ring {...(props() as any)} />);
    expect(graph3d).not.toHaveBeenCalled();
    settle();
    expect(graph3d).toHaveBeenCalled();
    expect(graph3d.mock.calls[0][0].graph.nodes[0].id).toBe("a");
  });

  it("centres the same filtered graph the workspace view would show", () => {
    const sectioned: VaultGraph = {
      nodes: [
        { id: "a", type: "note", section: "wiki" },
        { id: "b", type: "note", section: "raw" },
      ],
      edges: [],
    };
    render(
      <Ring
        {...(props({
          graphs: new Map<string, VaultGraph>([["w1", sectioned]]),
          filters: {
            sectionFilter: "wiki",
            showTags: true,
            showOrphans: true,
          },
        }) as any)}
      />,
    );
    settle();
    const ids = graph3d.mock.calls[0][0].graph.nodes.map((n: any) => n.id);
    expect(ids).toEqual(["a"]);
  });

  it("keeps both sections on a code workspace, which has none", () => {
    const sectioned: VaultGraph = {
      nodes: [
        { id: "x.ts", type: "note" },
        { id: "y.ts", type: "note" },
      ],
      edges: [],
    };
    render(
      <Ring
        {...(props({
          graphs: new Map<string, VaultGraph>([["w2", sectioned]]),
          filters: {
            sectionFilter: "wiki",
            showTags: true,
            showOrphans: true,
          },
        }) as any)}
      />,
    );
    act(() => byTestId("tile-w2")!.click()); // centre the code workspace
    settle();
    const ids = graph3d.mock.calls[0][0].graph.nodes.map((n: any) => n.id);
    expect(ids).toEqual(["x.ts", "y.ts"]);
  });

  it("holds the centre graph until the tile entrance has finished", () => {
    render(<Ring {...(props() as any)} />);
    // 3 tiles: 500 ms fly-out + 2 × 70 ms stagger = 640 ms, well past the
    // 300 ms settle debounce
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(graph3d).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(graph3d).toHaveBeenCalled();
  });

  it("spinning past tiles starts one simulation, not one per tile", () => {
    render(<Ring {...(props() as any)} />);
    // three wheel ticks 100 ms apart — each resets the settle debounce
    for (let i = 0; i < 3; i++) {
      wheel(600);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(graph3d).not.toHaveBeenCalled();
    }
    settle();
    expect(graph3d).toHaveBeenCalled();
    // every centre-graph render is the finally-centred workspace — the tiles
    // spun past never got a simulation
    const seen = graph3d.mock.calls.map((c) => c[0].graph.nodes[0].id);
    expect(new Set(seen).size).toBe(1);
  });

  it("wheel rotates the ring", () => {
    render(<Ring {...(props() as any)} />);
    wheel(600); // 600 × WHEEL_DEG(0.2) = 120° = one step of three tiles
    expect(byTestId("tile-w2")!.hasAttribute("data-centered")).toBe(true);
  });

  it("shows the index button when the centred code workspace's graph is empty", () => {
    const onIndex = vi.fn();
    render(
      <Ring
        {...(props({
          graphs: new Map<string, VaultGraph>([
            ["w1", graphOf("a")],
            ["w2", { nodes: [], edges: [] }],
          ]),
          onIndex,
        }) as any)}
      />,
    );
    act(() => byTestId("tile-w2")!.click()); // rotate it to centre
    settle();
    expect(byTestId("index-button")).toBeTruthy();
    act(() => byTestId("index-button")!.click());
    expect(onIndex).toHaveBeenCalledWith("w2");
    expect(graph3d).not.toHaveBeenCalled();
  });

  it("renders nothing in the centre while the graph is still loading", () => {
    render(<Ring {...(props({ graphs: new Map() }) as any)} />);
    settle();
    expect(graph3d).not.toHaveBeenCalled();
    expect(byTestId("index-button")).toBeNull();
  });

  it("renders an empty ring without crashing", () => {
    render(<Ring {...(props({ workspaces: [] }) as any)} />);
    settle();
    expect(byTestId("ring")).toBeTruthy();
    expect(graph3d).not.toHaveBeenCalled();
  });

  it("resets click suppression on pointer down so subsequent clicks work", () => {
    const onOpen = vi.fn();
    render(<Ring {...(props({ onOpen }) as any)} />);
    const ringEl = byTestId("ring")!;
    act(() => {
      ringEl.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, bubbles: true }),
      );
      ringEl.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 200, bubbles: true }),
      );
      ringEl.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 200, bubbles: true }),
      );
    });
    act(() => {
      ringEl.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, bubbles: true }),
      );
      byTestId("tile-w1")!.click();
    });
    expect(onOpen).toHaveBeenCalledWith(workspaces[0]);
  });

  // jsdom has no hit-testing, so the class is the assertable form of "a wheel
  // over the centre rotates the ring instead of also driving the 3D camera"
  it("keeps the centre graph out of the ring's gesture path", () => {
    render(<Ring {...(props() as any)} />);
    settle();
    expect(byTestId("ring-centre")!.className).toContain("pointer-events-none");
  });

  it("a rotation change does not re-render the centre Graph3D", () => {
    render(<Ring {...(props() as any)} />);
    settle();
    const renders = graph3d.mock.calls.length;
    wheel(10); // 2° — the same tile stays centred, but the ring re-renders
    // the memoized element keeps its identity, so React never reconciles the
    // centre graph — render count is the strong form of "no remount"
    expect(graph3d.mock.calls.length).toBe(renders);
  });
});

describe("Ring: hand actions", () => {
  it("registers its map and steps the ring through it", () => {
    const actionsRef = { current: {} as HandActions };
    render(<Ring {...(props({ actionsRef }) as any)} />);
    expect(actionsRef.current.drag).toBeDefined();
    act(() => actionsRef.current.step!(1));
    expect(byTestId("tile-w1")!.hasAttribute("data-centered")).toBe(false);
  });

  it("open acts on the live centred workspace, not a mount-time snapshot", () => {
    const onOpen = vi.fn();
    const actionsRef = { current: {} as HandActions };
    render(<Ring {...(props({ actionsRef, onOpen }) as any)} />);
    act(() => actionsRef.current.step!(1)); // dir 1 → w3 centred
    act(() => actionsRef.current.open!());
    expect(onOpen).toHaveBeenCalledWith(workspaces[2]);
  });

  it("orbit and zoom drive the centre graph's handle", () => {
    const actionsRef = { current: {} as HandActions };
    render(<Ring {...(props({ actionsRef }) as any)} />);
    settle();
    const handleRef = graph3d.mock.calls.at(-1)![0].handleRef;
    expect(handleRef).toBeDefined();
    const spin = vi.fn();
    const zoom = vi.fn();
    handleRef.current = { spin, zoom };
    act(() => actionsRef.current.orbit!(2));
    act(() => actionsRef.current.zoom!(1.1));
    expect(spin).toHaveBeenCalledWith(2);
    expect(zoom).toHaveBeenCalledWith(1.1);
  });

  it("clears the map on unmount", () => {
    const actionsRef = { current: {} as HandActions };
    render(<Ring {...(props({ actionsRef }) as any)} />);
    render(<div />);
    expect(actionsRef.current.step).toBeUndefined();
  });

  it("no longer owns a hand toggle", () => {
    render(<Ring {...(props() as any)} />);
    expect(byTestId("hand-toggle")).toBeNull();
  });
});

describe("Ring: refresh (layoutEpoch)", () => {
  it("a bump returns a rotated ring to the front", () => {
    render(<Ring {...(props() as any)} />);
    act(() => byTestId("tile-w2")!.click()); // rotate away
    expect(byTestId("tile-w2")!.hasAttribute("data-centered")).toBe(true);
    render(<Ring {...(props({ layoutEpoch: 1 }) as any)} />);
    expect(byTestId("tile-w1")!.hasAttribute("data-centered")).toBe(true);
  });

  // the bug: nothing remounts when already centred, so the forwarded epoch is
  // the only thing that can re-arm the centre graph's one-time camera fit
  it("a bump on an already-centred ring reaches the centre Graph3D without a remount", () => {
    render(<Ring {...(props() as any)} />);
    settle();
    expect(graph3d.mock.calls.at(-1)![0].layoutEpoch).toBe(0);
    render(<Ring {...(props({ layoutEpoch: 3 }) as any)} />);
    // same workspace, no settle wait, no remount — just the new epoch
    expect(graph3d.mock.calls.at(-1)![0].layoutEpoch).toBe(3);
    expect(graph3d.mock.calls.at(-1)![0].graph.nodes[0].id).toBe("a");
  });
});
