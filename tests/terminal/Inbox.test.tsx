/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, it, expect } from "vitest";
import Inbox from "../../src/renderer/terminal/Inbox";
import type { Workspace, WorkspaceStatus } from "../../src/shared/types";

const workspaces: Workspace[] = [
  {
    id: "w1",
    name: "web-app",
    rootPath: "D:\\web",
    kind: "code",
    sourceId: "gitnexus",
  },
  {
    id: "w2",
    name: "api",
    rootPath: "D:\\api",
    kind: "code",
    sourceId: "gitnexus",
  },
  {
    id: "w3",
    name: "vault",
    rootPath: "D:\\vault",
    kind: "vault",
    sourceId: "vault",
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

let currentTree: any = null;

function render(el: any) {
  if (typeof el.type === "function") {
    currentTree = el.type(el.props);
  } else {
    currentTree = el;
  }
}

function walk(node: any, fn: (n: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walk(item, fn);
      if (found) return found;
    }
    return null;
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

const screen = {
  getByTestId(testId: string) {
    const found = walk(
      currentTree,
      (n) => n.props && n.props["data-testid"] === testId,
    );
    if (!found)
      throw new Error(`Element with data-testid="${testId}" not found`);
    return {
      className: found.props.className ?? "",
      props: found.props,
    };
  },
  queryByTestId(testId: string) {
    const found = walk(
      currentTree,
      (n) => n.props && n.props["data-testid"] === testId,
    );
    if (!found) return null;
    return {
      className: found.props.className ?? "",
      props: found.props,
    };
  },
};

describe("Inbox", () => {
  it("shows a row only for workspaces with a live session", () => {
    render(
      <Inbox
        workspaces={workspaces}
        statuses={[
          status({ workspaceId: "w1", kind: "idle", message: "done" }),
          status({ workspaceId: "w2", kind: "none" }),
        ]}
        activeId="w1"
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByTestId("inbox-row-w1")).not.toBeNull();
    expect(screen.queryByTestId("inbox-row-w2")).toBeNull(); // kind none
    expect(screen.queryByTestId("inbox-row-w3")).toBeNull(); // absent from statuses
  });

  it("previews the message for an idle row", () => {
    render(
      <Inbox
        workspaces={workspaces}
        statuses={[
          status({ workspaceId: "w1", kind: "idle", message: "Pick A or B?" }),
        ]}
        activeId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("inbox-preview-w1").props.children).toBe(
      "Pick A or B?",
    );
  });

  it("previews the call line for a working row", () => {
    render(
      <Inbox
        workspaces={workspaces}
        statuses={[
          status({ workspaceId: "w1", kind: "working", call: 'Grep("x")' }),
        ]}
        activeId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("inbox-preview-w1").props.children).toBe(
      'Grep("x")',
    );
  });

  it("calls onSelect with the workspace when a row is clicked", () => {
    let picked: Workspace | null = null;
    render(
      <Inbox
        workspaces={workspaces}
        statuses={[status({ workspaceId: "w1", kind: "idle", message: "m" })]}
        activeId={null}
        onSelect={(ws) => {
          picked = ws;
        }}
      />,
    );
    screen.getByTestId("inbox-row-w1").props.onClick();
    // through its own type: TS cannot see the assignment inside onSelect
    expect((picked as Workspace | null)?.id).toBe("w1");
  });

  it("labels a delegated turn and omits the label otherwise", () => {
    render(
      <Inbox
        workspaces={workspaces}
        statuses={[
          status({
            workspaceId: "w1",
            kind: "working",
            call: "Bash(npm test)",
            delegatedBy: "JARVIS",
          }),
          status({ workspaceId: "w2", kind: "working", call: "Read(a.ts)" }),
        ]}
        activeId={null}
        onSelect={() => {}}
      />,
    );
    const tag = screen.getByTestId("inbox-delegated-w1");
    expect((tag.props.children as unknown[]).join("")).toBe(
      "↳ delegated by JARVIS",
    );
    expect(screen.queryByTestId("inbox-delegated-w2")).toBeNull();
  });

  it("lets the main agent's idle message wrap, and truncates every other row", () => {
    const fleet: Workspace[] = [
      {
        id: "self",
        name: "JARVIS",
        rootPath: "D:\\main",
        kind: "vault",
        sourceId: "vault",
        isSelf: true,
      },
      {
        id: "w1",
        name: "web-app",
        rootPath: "D:\\web",
        kind: "code",
        sourceId: "gitnexus",
      },
    ];
    render(
      <Inbox
        workspaces={fleet}
        statuses={[
          status({
            workspaceId: "self",
            kind: "idle",
            message: "a long summary",
          }),
          status({
            workspaceId: "w1",
            kind: "idle",
            message: "a long summary",
          }),
        ]}
        activeId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("inbox-preview-self").className).not.toContain(
      "truncate",
    );
    expect(screen.getByTestId("inbox-preview-w1").className).toContain(
      "truncate",
    );
  });

  it("keeps the main agent's working call line on one line", () => {
    const fleet: Workspace[] = [
      {
        id: "self",
        name: "JARVIS",
        rootPath: "D:\\main",
        kind: "vault",
        sourceId: "vault",
        isSelf: true,
      },
    ];
    render(
      <Inbox
        workspaces={fleet}
        statuses={[
          status({
            workspaceId: "self",
            kind: "working",
            call: "Bash(npm test)",
          }),
        ]}
        activeId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("inbox-preview-self").className).toContain(
      "truncate",
    );
  });
});
