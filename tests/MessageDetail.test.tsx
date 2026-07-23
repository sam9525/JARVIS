/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, it, expect } from "vitest";
import MessageDetail from "../src/renderer/MessageDetail";
import type { Workspace, WorkspaceStatus } from "../src/shared/types";

const ws: Workspace = { id: "w1", name: "web-app", rootPath: "D:\\web", kind: "code" };
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

describe("MessageDetail", () => {
  it("renders the full message body", () => {
    render(
      <MessageDetail
        workspace={ws}
        status={status({ message: "Pick A or B?" })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("message-detail-body").props.children).toBe(
      "Pick A or B?",
    );
  });

  it("renders nothing when there is no workspace", () => {
    render(<MessageDetail workspace={null} status={null} onClose={() => {}} />);
    expect(currentTree).toBeNull();
  });

  it("fires onClose from the close button", () => {
    let closed = false;
    render(
      <MessageDetail
        workspace={ws}
        status={status({ message: "m" })}
        onClose={() => {
          closed = true;
        }}
      />,
    );
    screen.getByTestId("message-detail-close").props.onClick();
    expect(closed).toBe(true);
  });
});
