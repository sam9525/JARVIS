/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { vi, describe, it, expect } from "vitest";
import EmptyGraph from "../../src/renderer/graph/EmptyGraph";

// Same shallow shim as tests/MissionControl.test.tsx: call the component
// function and walk the element tree it returns. EmptyGraph is hook-free.
let currentTree: any = null;

function render(el: any) {
  currentTree = typeof el.type === "function" ? el.type(el.props) : el;
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

function text(node: any): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}

function button() {
  const found = walk(
    currentTree,
    (n) => n.props && n.props["data-testid"] === "index-button",
  );
  if (!found) throw new Error("index-button not found");
  return { text: text(found), props: found.props };
}

describe("EmptyGraph", () => {
  it("offers to index when idle, and fires onIndex", () => {
    const onIndex = vi.fn();
    render(<EmptyGraph state="idle" onIndex={onIndex} />);
    expect(button().text).toBe("Index with GitNexus");
    expect(button().props.disabled).toBe(false);
    button().props.onClick({ stopPropagation: () => {} });
    expect(onIndex).toHaveBeenCalled();
  });

  it("disables the button while indexing", () => {
    render(<EmptyGraph state="running" onIndex={() => {}} />);
    expect(button().text).toBe("indexing…");
    expect(button().props.disabled).toBe(true);
  });

  it("offers a retry after a failure and puts the reason in the tooltip", () => {
    render(
      <EmptyGraph
        state="error"
        error="gitnexus not found"
        onIndex={() => {}}
      />,
    );
    expect(button().text).toBe("index failed — retry");
    expect(button().props.disabled).toBe(false);
    expect(button().props.title).toContain("gitnexus not found");
  });

  it("shows a failed read's reason and offers no index button", () => {
    render(
      <EmptyGraph
        state="idle"
        failed="GitNexus index busy, refresh"
        onIndex={() => {}}
      />,
    );
    expect(text(currentTree)).toBe("GitNexus index busy, refresh");
    expect(() => button()).toThrow("index-button not found");
  });

  it("stops the click from reaching the card behind it", () => {
    // the mission-control card is itself clickable; indexing must not also
    // navigate away from the fleet view
    const stopPropagation = vi.fn();
    render(<EmptyGraph state="idle" onIndex={() => {}} />);
    button().props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
  });
});
