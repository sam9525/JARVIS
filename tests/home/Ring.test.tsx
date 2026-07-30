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

// the camera/WASM boundary is mocked: tests drive the gesture layer by
// feeding synthetic landmark frames straight into the captured callback
const tracker = vi.hoisted(() => ({
  frameCb: null as null | ((f: { hand: unknown; t: number }) => void),
  stop: vi.fn(),
  impl: null as null | (() => Promise<() => void>),
}));
vi.mock("../../src/renderer/hands/hand-tracker", () => ({
  startHandTracker: (cb: (f: { hand: unknown; t: number }) => void) => {
    tracker.frameCb = cb;
    return tracker.impl
      ? tracker.impl()
      : Promise.reject(new Error("No camera available"));
  },
}));

import Ring from "../../src/renderer/home/Ring";
import { fistHand, twoFingerHand } from "../hands/hands";
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
  width: 900,
  height: 600,
  indexing: {},
  onIndex: () => undefined,
  onOpen: () => undefined,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  graph3d.mockClear();
  tracker.frameCb = null;
  tracker.stop.mockClear();
  tracker.impl = null;
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

// flush the settle debounce (300 ms) and the wheel-snap timer (200 ms)
const settle = () =>
  act(() => {
    vi.advanceTimersByTime(600);
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
          statuses: [status({ workspaceId: "w1", kind: "running", call })],
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
});

describe("Ring: hand control", () => {
  const enable = async () => {
    await act(async () => {
      byTestId("hand-toggle")!.click();
    });
    await act(async () => {
      await Promise.resolve(); // flush the startHandTracker promise chain
    });
  };
  const feed = (hand: unknown, t: number) =>
    act(() => tracker.frameCb!({ hand, t }));

  it("shows the toggle, off by default, with no camera started", () => {
    render(<Ring {...(props() as any)} />);
    expect(byTestId("hand-toggle")).toBeTruthy();
    expect(byTestId("hand-live")).toBeNull();
    expect(tracker.frameCb).toBeNull();
  });

  it("surfaces a tracker failure on the toggle and leaves the ring intact", async () => {
    render(<Ring {...(props() as any)} />);
    await enable(); // default mock impl rejects: "No camera available"
    expect(byTestId("hand-error")!.textContent).toContain(
      "No camera available",
    );
    expect(byTestId("hand-live")).toBeNull();
    expect(byTestId("tile-w1")).toBeTruthy(); // ring still works
  });

  it("shows a live indicator while the camera runs", async () => {
    tracker.impl = () => Promise.resolve(tracker.stop);
    render(<Ring {...(props() as any)} />);
    await enable();
    expect(byTestId("hand-live")).toBeTruthy();
    expect(byTestId("hand-error")).toBeNull();
  });

  it("a two-finger swipe steps the ring off the centred tile", async () => {
    tracker.impl = () => Promise.resolve(tracker.stop);
    render(<Ring {...(props() as any)} />);
    await enable();
    expect(byTestId("tile-w1")!.hasAttribute("data-centered")).toBe(true);
    for (let i = 0; i < 10; i++) feed(twoFingerHand(0.1 + i * 0.08), i / 30);
    expect(byTestId("tile-w1")!.hasAttribute("data-centered")).toBe(false);
  });

  it("a held fist turns hand control off and stops the camera", async () => {
    tracker.impl = () => Promise.resolve(tracker.stop);
    render(<Ring {...(props() as any)} />);
    await enable();
    feed(fistHand(), 0);
    feed(fistHand(), 0.6);
    feed(fistHand(), 1.1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(byTestId("hand-live")).toBeNull();
    expect(tracker.stop).toHaveBeenCalled();
  });

  it("unmounting the ring stops the camera", async () => {
    tracker.impl = () => Promise.resolve(tracker.stop);
    render(<Ring {...(props() as any)} />);
    await enable();
    render(<div />); // leaving the ring view unmounts Ring
    expect(tracker.stop).toHaveBeenCalled();
  });
});
