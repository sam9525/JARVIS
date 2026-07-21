/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, it, expect } from "vitest";
import WorkspaceRail from "../src/renderer/WorkspaceRail";
import type { Workspace, WorkspaceStatus } from "../src/shared/types";

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
  getByTitle(titlePattern: string | RegExp) {
    const found = walk(currentTree, (n) => {
      const title = n.props?.title;
      if (typeof title !== "string") return false;
      if (titlePattern instanceof RegExp) return titlePattern.test(title);
      return title === titlePattern;
    });
    if (!found)
      throw new Error(`Element with title matching ${titlePattern} not found`);
    return {
      title: found.props.title,
      props: found.props,
    };
  },
};

describe("WorkspaceRail badges", () => {
  it("shows a badge whose class matches each workspace's status", () => {
    render(
      <WorkspaceRail
        workspaces={workspaces}
        activeId="w1"
        statuses={[
          status({ workspaceId: "w1", kind: "running" }),
          status({ workspaceId: "w2", kind: "waiting" }),
        ]}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("badge-w1").className).toContain("bg-accent");
    expect(screen.getByTestId("badge-w2").className).toContain("bg-warm");
  });

  it("renders no badge for a workspace with no session", () => {
    render(
      <WorkspaceRail
        workspaces={workspaces}
        activeId="w1"
        statuses={[status({ workspaceId: "w1", kind: "none" })]}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByTestId("badge-w1")).toBeNull();
  });

  it("renders no badge for a workspace absent from the status array", () => {
    render(
      <WorkspaceRail
        workspaces={workspaces}
        activeId="w1"
        statuses={[]}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByTestId("badge-w2")).toBeNull();
  });

  it("puts the status and call line in the button tooltip", () => {
    render(
      <WorkspaceRail
        workspaces={workspaces}
        activeId="w1"
        statuses={[
          status({
            workspaceId: "w2",
            kind: "waiting",
            call: "Bash(npm test)",
          }),
        ]}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByTitle(/waiting on you — Bash\(npm test\)/i),
    ).toBeTruthy();
  });
});
