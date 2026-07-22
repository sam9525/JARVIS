/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { vi, describe, it, expect } from "vitest";
// Cards render a real ForceGraph2D now, and force-graph touches window at
// import time. This suite is about the chrome around the thumbnail, and the
// shallow renderer below never descends into it anyway.
vi.mock("../src/renderer/MiniGraph", () => ({ default: () => null }));

import MissionControl from "../src/renderer/MissionControl";
import { emptyState } from "../src/renderer/highlight-store";
import { defaultSettings } from "../src/shared/types";
import type {
  VaultGraph,
  Workspace,
  WorkspaceStatus,
} from "../src/shared/types";

const workspaces: Workspace[] = [
  { id: "w1", name: "vault", rootPath: "D:\\vault", kind: "vault" },
  { id: "w2", name: "gitnexus", rootPath: "D:\\gn", kind: "code" },
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
  groups: [],
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
              kind: "waiting",
              call: "Bash(npm test)",
            }),
          ],
        }) as any)}
      />,
    );
    expect(screen.byTestId("status-w2").text).toContain("waiting on you");
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
            status({ workspaceId: "w1", kind: "running" }),
            status({ workspaceId: "w2", kind: "waiting" }),
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

  it("summarises the fleet, and says so when nothing is running", () => {
    render(<MissionControl {...(props() as any)} />);
    expect(screen.byTestId("mc-summary").text).toBe("no active sessions");

    render(
      <MissionControl
        {...(props({
          statuses: [
            status({ workspaceId: "w1", kind: "waiting" }),
            status({ workspaceId: "w2", kind: "running" }),
          ],
        }) as any)}
      />,
    );
    expect(screen.byTestId("mc-summary").text).toBe("1 waiting · 1 running");
  });

  it("renders a card for a workspace whose graph has not loaded yet", () => {
    render(<MissionControl {...(props() as any)} />);
    expect(screen.byTestId("card-w1")).toBeTruthy();
  });

  it("shows the index button on a code workspace whose graph loaded empty", () => {
    render(
      <MissionControl
        {...(props({
          graphs: new Map<string, VaultGraph>([["w2", { nodes: [], edges: [] }]]),
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
          graphs: new Map<string, VaultGraph>([["w1", { nodes: [], edges: [] }]]),
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
            ["w2", { nodes: [{ id: "a.ts", type: "note" as const }], edges: [] }],
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
          graphs: new Map<string, VaultGraph>([["w2", { nodes: [], edges: [] }]]),
          onIndex,
          onSelect,
        }) as any)}
      />,
    );
    screen.byTestId("index-button").props.onClick({ stopPropagation: () => {} });
    expect(onIndex).toHaveBeenCalledWith("w2");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reflects a workspace's indexing state on its button", () => {
    render(
      <MissionControl
        {...(props({
          graphs: new Map<string, VaultGraph>([["w2", { nodes: [], edges: [] }]]),
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
});
