import { describe, expect, it } from "vitest";
import {
  approvedDocClose,
  docKindOf,
  docPreviewId,
  docWriteOf,
} from "../../src/renderer/ui/ask-doc";
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

  it("accepts an upper-case .md extension", () => {
    const upper = "docs/superpowers/specs/A.MD";
    expect(docWriteOf(event("Write", "post", upper), false)?.nodeId).toBe(
      upper,
    );
  });

  it("recognises a post Edit of a plan", () => {
    const planId = "docs/superpowers/plans/p.md";
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

describe("docPreviewId", () => {
  it("re-adds the worktree folder the event id dropped", () => {
    expect(docPreviewId("docs/superpowers/plans/p.md", "t1")).toBe(
      ".worktrees/t1/docs/superpowers/plans/p.md",
    );
  });

  it("leaves the id alone outside a worktree", () => {
    expect(docPreviewId("docs/superpowers/plans/p.md", null)).toBe(
      "docs/superpowers/plans/p.md",
    );
  });
});

describe("approvedDocClose", () => {
  const docs = {
    spec: "docs/superpowers/specs/a.md",
    plan: "docs/superpowers/plans/a.md",
  };
  const spec = { workspaceId: "d:/r", nodeId: docs.spec };
  const yes = (header: string, label: string) => [{ header, label }];

  it("closes on Spec → Approve for that session's spec", () => {
    expect(approvedDocClose(yes("Spec", "Approve"), docs, "d:/r", spec)).toBe(
      true,
    );
  });

  it("closes on plan → Approve (Recommended)", () => {
    expect(
      approvedDocClose(yes("plan", "Approve (Recommended)"), docs, "d:/r", {
        workspaceId: "d:/r",
        nodeId: docs.plan,
      }),
    ).toBe(true);
  });

  it.each([
    ["Review in browser", yes("Spec", "Review in browser"), docs, "d:/r", spec],
    ["another header", yes("Other", "Approve"), docs, "d:/r", spec],
    ["no answers", [], docs, "d:/r", spec],
    ["no preview", yes("Spec", "Approve"), docs, "d:/r", null],
    [
      "a different file",
      yes("Spec", "Approve"),
      docs,
      "d:/r",
      { workspaceId: "d:/r", nodeId: "src/a.ts" },
    ],
    ["a different workspace", yes("Spec", "Approve"), docs, "d:/other", spec],
    [
      "no doc of that kind",
      yes("Spec", "Approve"),
      { plan: docs.plan },
      "d:/r",
      spec,
    ],
    ["no docs at all", yes("Spec", "Approve"), undefined, "d:/r", spec],
  ])("keeps it for %s", (_name, answers, d, ws, preview) => {
    expect(approvedDocClose(answers, d, ws, preview)).toBe(false);
  });
});
