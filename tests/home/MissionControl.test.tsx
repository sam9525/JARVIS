/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { vi, describe, it, expect } from "vitest";
// Cards render a real ForceGraph2D now, and force-graph touches window at
// import time. This suite is about the chrome around the thumbnail, and the
// shallow renderer below never descends into it anyway.
vi.mock("../../src/renderer/graph/MiniGraph", () => ({ default: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import MissionControl from "../../src/renderer/home/MissionControl";
import { emptyState } from "../../src/renderer/session/highlight-store";
import { defaultSettings } from "../../src/shared/types";
import type {
  VaultGraph,
  Workspace,
  WorkspaceStatus,
} from "../../src/shared/types";

const workspaces: Workspace[] = [
  {
    id: "w1",
    name: "vault",
    rootPath: "D:\\vault",
    kind: "vault",
    sourceId: "vault",
  },
  {
    id: "w2",
    name: "gitnexus",
    rootPath: "D:\\gn",
    kind: "code",
    sourceId: "gitnexus",
  },
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

// Same shim as tests/WorkspaceRail.test.tsx: call the component function and
// walk the element tree it returns. MissionControl is deliberately hook-free
// so this works without a DOM.
let currentTree: any = null;

function render(el: any) {
  currentTree = typeof el.type === "function" ? el.type(el.props) : el;
}

function walk(node: any, fn: (n: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  // a mapped list sits inside its parent's children as a nested array, so an
  // array is a node to descend into, never a node to match
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walk(item, fn);
      if (found) return found;
    }
    return null;
  }
  if (typeof node.type === "function") {
    const rendered = node.type(node.props);
    return walk(rendered, fn);
  }
  if (fn(node)) return node;
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = walk(child, fn);
      if (found) return found;
    }
  } else if (children && typeof children === "object") {
    return walk(children, fn);
  }
  return null;
}

function text(node: any): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}

const screen = {
  byTestId(testId: string) {
    const found = walk(
      currentTree,
      (n) => n.props && n.props["data-testid"] === testId,
    );
    if (!found)
      throw new Error(`Element with data-testid="${testId}" not found`);
    return {
      className: found.props.className ?? "",
      text: text(found),
      props: found.props,
    };
  },
};

const props = (over: Partial<Record<string, unknown>> = {}) => ({
  workspaces,
  statuses: [] as WorkspaceStatus[],
  graphs: new Map<string, VaultGraph>(),
  getStore: () => emptyState(),
  groups: {},
  view: defaultSettings().views["2d"],
  filters: {
    sectionFilter: "both" as const,
    showTags: true,
    showOrphans: true,
  },
  now: 1_700_000_000_000,
  onSelect: () => {},
  indexing: {} as Record<string, { state: string; error?: string }>,
  onIndex: () => {},
  ...over,
});

describe("MissionControl", () => {
  it("renders one card per workspace", () => {
    render(<MissionControl {...(props() as any)} />);
    expect(screen.byTestId("name-w1").text).toBe("vault");
    expect(screen.byTestId("name-w2").text).toBe("gitnexus");
  });

  it("shows the status label and the call line", () => {
    render(
      <MissionControl
        {...(props({
          statuses: [
            status({
              workspaceId: "w2",
              kind: "blocked",
              call: "Bash(npm test)",
            }),
          ],
        }) as any)}
      />,
    );
    expect(screen.byTestId("status-w2").text).toContain("needs approval");
    expect(screen.byTestId("call-w2").text).toBe("Bash(npm test)");
  });

  it("shows read and edit counts", () => {
    render(
      <MissionControl
        {...(props({
          statuses: [status({ workspaceId: "w1", reads: 8, edits: 2 })],
        }) as any)}
      />,
    );
    const counts = screen.byTestId("counts-w1").text;
    expect(counts).toContain("8");
    expect(counts).toContain("2");
  });

  it("treats a workspace with no status as having no session", () => {
    render(<MissionControl {...(props() as any)} />);
    expect(screen.byTestId("status-w1").text).toContain("no session");
    expect(screen.byTestId("status-w2").text).toContain("no session");
  });

  it("marks only the waiting card so one card can claim attention", () => {
    render(
      <MissionControl
        {...(props({
          statuses: [
            status({ workspaceId: "w1", kind: "working" }),
            status({ workspaceId: "w2", kind: "blocked" }),
          ],
        }) as any)}
      />,
    );
    expect(screen.byTestId("card-w2").className).toContain("border-warm");
    expect(screen.byTestId("card-w1").className).not.toContain("border-warm");
  });

  it("selects the workspace when its card is clicked", () => {
    const onSelect = vi.fn();
    render(<MissionControl {...(props({ onSelect }) as any)} />);
    screen.byTestId("card-w2").props.onClick();
    expect(onSelect).toHaveBeenCalledWith(workspaces[1]);
  });

  it("renders a card for a workspace whose graph has not loaded yet", () => {
    render(<MissionControl {...(props() as any)} />);
    expect(screen.byTestId("card-w1")).toBeTruthy();
  });

  it("shows the index button on a code workspace whose graph loaded empty", () => {
    render(
      <MissionControl
        {...(props({
          graphs: new Map<string, VaultGraph>([
            ["w2", { nodes: [], edges: [] }],
          ]),
        }) as any)}
      />,
    );
    expect(screen.byTestId("index-button").text).toBe("Index with GitNexus");
  });

  it("shows no index button while a graph is still loading", () => {
    // absent from the map means "not fetched yet", not "empty"
    render(<MissionControl {...(props() as any)} />);
    expect(() => screen.byTestId("index-button")).toThrow();
  });

  it("shows no index button for a vault, which is never gitnexus-indexed", () => {
    render(
      <MissionControl
        {...(props({
          graphs: new Map<string, VaultGraph>([
            ["w1", { nodes: [], edges: [] }],
          ]),
        }) as any)}
      />,
    );
    expect(() => screen.byTestId("index-button")).toThrow();
  });

  it("shows no index button for a graphify workspace — indexing would convert it", () => {
    // an empty graph here means a broken graph.json, and `gitnexus analyze`
    // would flip the workspace's source on the next boot rather than fix it
    render(
      <MissionControl
        {...(props({
          workspaces: [
            {
              id: "w3",
              name: "graphify",
              rootPath: "D:\\gf",
              kind: "code",
              sourceId: "graphify",
            },
          ],
          graphs: new Map<string, VaultGraph>([
            ["w3", { nodes: [], edges: [] }],
          ]),
        }) as any)}
      />,
    );
    expect(() => screen.byTestId("index-button")).toThrow();
  });

  it("shows no index button once a graph has nodes", () => {
    render(
      <MissionControl
        {...(props({
          graphs: new Map<string, VaultGraph>([
            [
              "w2",
              { nodes: [{ id: "a.ts", type: "note" as const }], edges: [] },
            ],
          ]),
        }) as any)}
      />,
    );
    expect(() => screen.byTestId("index-button")).toThrow();
  });

  it("fires onIndex with the workspace id, without selecting the card", () => {
    const onIndex = vi.fn();
    const onSelect = vi.fn();
    render(
      <MissionControl
        {...(props({
          graphs: new Map<string, VaultGraph>([
            ["w2", { nodes: [], edges: [] }],
          ]),
          onIndex,
          onSelect,
        }) as any)}
      />,
    );
    screen
      .byTestId("index-button")
      .props.onClick({ stopPropagation: () => {} });
    expect(onIndex).toHaveBeenCalledWith("w2");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reflects a workspace's indexing state on its button", () => {
    render(
      <MissionControl
        {...(props({
          graphs: new Map<string, VaultGraph>([
            ["w2", { nodes: [], edges: [] }],
          ]),
          indexing: { w2: { state: "running" } },
        }) as any)}
      />,
    );
    expect(screen.byTestId("index-button").props.disabled).toBe(true);
  });

  it("opens the workspace on Enter, since the card is no longer a button", () => {
    const onSelect = vi.fn();
    render(<MissionControl {...(props({ onSelect }) as any)} />);
    screen.byTestId("card-w2").props.onKeyDown({
      key: "Enter",
      preventDefault: () => {},
    });
    expect(onSelect).toHaveBeenCalledWith(workspaces[1]);
  });

  it("ignores other keys on a card", () => {
    const onSelect = vi.fn();
    render(<MissionControl {...(props({ onSelect }) as any)} />);
    screen.byTestId("card-w2").props.onKeyDown({
      key: "a",
      preventDefault: () => {},
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  // the index button lives inside the card, so its own Enter bubbles up here
  // first — keying it must index, not navigate away from the thing being indexed
  it("leaves Enter alone when it came from a control inside the card", () => {
    const onSelect = vi.fn();
    render(<MissionControl {...(props({ onSelect }) as any)} />);
    const card = screen.byTestId("card-w2");
    card.props.onKeyDown({
      key: "Enter",
      target: { name: "the index button" },
      currentTarget: { name: "the card" },
      preventDefault: () => {},
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows delegation provenance on the card's status line", () => {
    render(
      <MissionControl
        {...(props({
          statuses: [
            status({
              workspaceId: "w2",
              kind: "working",
              delegatedBy: "JARVIS",
            }),
          ],
        }) as any)}
      />,
    );
    expect(screen.byTestId("status-w2").text).toContain("delegated by JARVIS");
    expect(screen.byTestId("status-w1").text).not.toContain("delegated");
  });

  it("carries the untruncated call in a native tooltip", () => {
    const call =
      "Bash(npx vitest run tests/graph/use-workspace-graphs.test.tsx --reporter verbose)";
    render(
      <MissionControl
        {...(props({
          statuses: [status({ workspaceId: "w1", kind: "working", call })],
        }) as any)}
      />,
    );
    expect(screen.byTestId("call-w1").props.title).toBe(call);
  });

  it("has no tooltip when there is no call", () => {
    render(
      <MissionControl
        {...(props({ statuses: [status({ workspaceId: "w1" })] }) as any)}
      />,
    );
    expect(screen.byTestId("call-w1").props.title).toBeUndefined();
  });
});

describe("six status kinds on a card", () => {
  const renderCard = (s: WorkspaceStatus) =>
    renderToStaticMarkup(
      <MissionControl
        {...(props({ workspaces: [workspaces[0]], statuses: [s] }) as any)}
      />,
    );

  const labelOf = (kind: WorkspaceStatus["kind"]) =>
    renderCard(status({ workspaceId: "w1", kind }));

  it("labels each kind", () => {
    expect(labelOf("working")).toContain("working");
    expect(labelOf("asking")).toContain("asking you");
    expect(labelOf("blocked")).toContain("needs approval");
    expect(labelOf("crashed")).toContain("crashed");
    expect(labelOf("none")).toContain("no session");
  });

  it("borders a card warm when it wants you and alarm when it died", () => {
    expect(labelOf("asking")).toContain("border-warm");
    expect(labelOf("blocked")).toContain("border-warm");
    expect(labelOf("crashed")).toContain("border-alarm");
    expect(labelOf("idle")).toContain("border-edge");
  });
});
