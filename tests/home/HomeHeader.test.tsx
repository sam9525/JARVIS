/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import HomeHeader from "../../src/renderer/home/HomeHeader";
import type { WorkspaceStatus } from "../../src/shared/types";

const status = (over: Partial<WorkspaceStatus>): WorkspaceStatus => ({
  workspaceId: "w1",
  kind: "idle",
  call: "",
  since: 0,
  reads: 0,
  edits: 0,
  ...over,
});

// same shallow shim as the other home tests — HomeHeader is hook-free
function find(node: any, fn: (n: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = find(item, fn);
      if (found) return found;
    }
    return null;
  }
  if (fn(node)) return node;
  return find(node.props?.children, fn);
}

const summaryOf = (statuses: WorkspaceStatus[]) =>
  find(
    HomeHeader({ statuses }),
    (n) => n.props?.["data-testid"] === "mc-summary",
  )?.props.children;

describe("HomeHeader", () => {
  it("summarises the fleet, and says so when nothing is running", () => {
    expect(summaryOf([])).toBe("no active sessions");
    expect(
      summaryOf([
        status({ workspaceId: "w1", kind: "blocked" }),
        status({ workspaceId: "w2", kind: "working" }),
      ]),
    ).toBe("1 blocked · 1 working");
  });

  it("carries the controls the App hands it, over every home view", () => {
    const tree = HomeHeader({
      statuses: [],
      children: { type: "b", props: { "data-testid": "ctl" } } as any,
    });
    expect(find(tree, (n) => n.props?.["data-testid"] === "ctl")).toBeTruthy();
    // the bar floats over Ring/Fleet: it must not eat their drag gestures
    expect(tree.props.className).toContain("pointer-events-none");
    expect(tree.props.className).toContain("[&_button]:pointer-events-auto");
  });
});

describe("enterClass", () => {
  it("adds nothing when absent", () => {
    const html = renderToStaticMarkup(<HomeHeader statuses={[]} />);
    expect(html).not.toContain("boot-in");
  });

  it("merges the class into the header root", () => {
    const html = renderToStaticMarkup(
      <HomeHeader statuses={[]} enterClass="boot-in" />,
    );
    expect(html).toContain("boot-in");
  });
});

describe("summary over six kinds", () => {
  const st = (kind: WorkspaceStatus["kind"], id: string): WorkspaceStatus => ({
    workspaceId: id,
    kind,
    call: "",
    since: 0,
    reads: 0,
    edits: 0,
  });

  it("counts the two stopped states separately", () => {
    const html = renderToStaticMarkup(
      <HomeHeader statuses={[st("asking", "a"), st("blocked", "b")]} />,
    );
    expect(html).toContain("1 asking");
    expect(html).toContain("1 blocked");
  });

  it("counts working and crashed", () => {
    const html = renderToStaticMarkup(
      <HomeHeader statuses={[st("working", "a"), st("crashed", "b")]} />,
    );
    expect(html).toContain("1 working");
    expect(html).toContain("1 crashed");
  });

  it("says so when nothing is running", () => {
    const html = renderToStaticMarkup(<HomeHeader statuses={[]} />);
    expect(html).toContain("no active sessions");
  });
});
