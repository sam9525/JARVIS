import { describe, it, expect } from "vitest";
import {
  focusedPreviewNode,
  isPreviewEdit,
  previewNoteIds,
  previewWorkspace,
} from "../../src/renderer/preview/preview-target";
import type { ToolEvent, VaultGraph, Workspace } from "../../src/shared/types";

const target = { workspaceId: "w1", nodeId: "docs/spec" };
const ws = (id: string) => ({ id }) as Workspace;
const ev = (over: Partial<ToolEvent>): ToolEvent => ({
  sessionId: "s1",
  workspaceId: "w1",
  sessionKey: "w1",
  phase: "post",
  tool: "Edit",
  nodeIds: ["docs/spec"],
  ts: 0,
  ...over,
});
const graph = (ids: string[]): VaultGraph => ({
  nodes: [
    ...ids.map((id) => ({ id, type: "note" as const })),
    { id: "tag:x", type: "tag" as const },
  ],
  edges: [],
});

describe("previewWorkspace", () => {
  it("returns the target's workspace", () => {
    expect(previewWorkspace(target, [ws("w0"), ws("w1")])?.id).toBe("w1");
  });
  it("returns null with no target or an unknown id", () => {
    expect(previewWorkspace(null, [ws("w1")])).toBeNull();
    expect(previewWorkspace(target, [ws("w2")])).toBeNull();
  });
});

describe("focusedPreviewNode", () => {
  it("focuses when the target's workspace is on screen", () => {
    expect(focusedPreviewNode(target, "w1", false)).toBe("docs/spec");
  });
  it("does not focus on home, in another workspace, or with no target", () => {
    expect(focusedPreviewNode(target, "w1", true)).toBeNull();
    expect(focusedPreviewNode(target, "w2", false)).toBeNull();
    expect(focusedPreviewNode(null, "w1", false)).toBeNull();
  });
});

describe("isPreviewEdit", () => {
  it("matches an edit of the node in the target's workspace", () => {
    expect(isPreviewEdit(ev({}), target)).toBe(true);
  });
  it("ignores other workspaces, reads and a missing target", () => {
    expect(isPreviewEdit(ev({ workspaceId: "w2" }), target)).toBe(false);
    expect(isPreviewEdit(ev({ tool: "Read" }), target)).toBe(false);
    expect(isPreviewEdit(ev({}), null)).toBe(false);
  });
});

describe("previewNoteIds", () => {
  const cards = new Map([["w2", graph(["c"])]]);
  it("uses the active graph's notes for the active workspace", () => {
    expect(previewNoteIds(target, "w1", graph(["a", "b"]), cards)).toEqual([
      "a",
      "b",
    ]);
  });
  it("uses the cached graph of another workspace", () => {
    expect(
      previewNoteIds(
        { workspaceId: "w2", nodeId: "c" },
        "w1",
        graph([]),
        cards,
      ),
    ).toEqual(["c"]);
  });
  it("is empty when the other workspace has no cached graph", () => {
    expect(
      previewNoteIds(
        { workspaceId: "w3", nodeId: "c" },
        "w1",
        graph(["a"]),
        cards,
      ),
    ).toEqual([]);
  });
});
