import { describe, expect, it } from "vitest";
import { docKindOf, docWriteOf } from "../../src/renderer/ui/ask-doc";
import type { ToolEvent } from "../../src/shared/types";

function event(
  tool: ToolEvent["tool"],
  phase: ToolEvent["phase"],
  nodeId: string,
): ToolEvent {
  return {
    sessionId: "s",
    workspaceId: "w",
    sessionKey: "k",
    phase,
    tool,
    nodeIds: [nodeId],
    ts: 1,
  };
}

describe("docKindOf", () => {
  it("matches spec and plan headers regardless of case and padding", () => {
    expect(docKindOf("Spec")).toBe("spec");
    expect(docKindOf(" spec ")).toBe("spec");
    expect(docKindOf("PLAN")).toBe("plan");
  });

  it("rejects other headers", () => {
    expect(docKindOf("Specs")).toBeNull();
    expect(docKindOf("")).toBeNull();
    expect(docKindOf("Close signal")).toBeNull();
  });
});

describe("docWriteOf in a code workspace", () => {
  const id = "docs/superpowers/specs/2026-10-27-a-design.md";

  it("recognises a post Write of a spec", () => {
    expect(docWriteOf(event("Write", "post", id), false)).toEqual({
      kind: "spec",
      nodeId: id,
    });
  });

  it("recognises a post Edit of a plan inside a worktree", () => {
    const planId = ".worktrees/t1/docs/superpowers/plans/p.md";
    expect(docWriteOf(event("Edit", "post", planId), false)).toEqual({
      kind: "plan",
      nodeId: planId,
    });
  });

  it("ignores pre events and reads", () => {
    expect(docWriteOf(event("Write", "pre", id), false)).toBeNull();
    expect(docWriteOf(event("Read", "post", id), false)).toBeNull();
  });

  it("ignores nested folders and non-markdown files", () => {
    expect(
      docWriteOf(
        event("Write", "post", "docs/superpowers/specs/sub/a.md"),
        false,
      ),
    ).toBeNull();
    expect(
      docWriteOf(event("Write", "post", "docs/superpowers/specs/a.ts"), false),
    ).toBeNull();
  });
});

describe("docWriteOf in a vault workspace", () => {
  it("accepts an extensionless id whose name holds dots", () => {
    const id = "docs/superpowers/specs/2026-09-01-v0.4.4-a-design";
    expect(docWriteOf(event("Write", "post", id), true)).toEqual({
      kind: "spec",
      nodeId: id,
    });
  });
});
