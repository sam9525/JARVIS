import { describe, it, expect } from "vitest";
import { createStatusStore, STALE_MS } from "../../src/main/workspace-status";
import type { StatusEvent, ToolEvent } from "../../src/shared/types";

const ev = (over: Partial<StatusEvent>): StatusEvent => ({
  workspaceId: "w1",
  sessionId: "s1",
  kind: "running",
  call: "",
  ts: 1000,
  ...over,
});

const tool = (over: Partial<ToolEvent>): ToolEvent => ({
  sessionId: "s1",
  workspaceId: "w1",
  phase: "pre",
  tool: "Read",
  nodeIds: ["a"],
  ts: 1000,
  ...over,
});

const kindOf = (s: ReturnType<typeof createStatusStore>, id = "w1") =>
  s.snapshot().find((x) => x.workspaceId === id)?.kind;

describe("status store", () => {
  it("a workspace with no events is absent from the snapshot", () => {
    expect(createStatusStore().snapshot()).toEqual([]);
  });

  it("records kind, call, and since from a status event", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "running", call: "Bash(npm test)", ts: 5000 }));
    expect(s.snapshot()[0]).toMatchObject({
      workspaceId: "w1",
      kind: "running",
      call: "Bash(npm test)",
      since: 5000,
    });
  });

  it("running → waiting → idle", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "running" }));
    expect(kindOf(s)).toBe("running");
    s.applyStatus(ev({ kind: "waiting", ts: 2000 }));
    expect(kindOf(s)).toBe("waiting");
    s.applyStatus(ev({ kind: "idle", ts: 3000 }));
    expect(kindOf(s)).toBe("idle");
  });

  it("a waiting workspace keeps the call line that caused the prompt", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "running", call: "Bash(npm test)" }));
    s.applyStatus(ev({ kind: "waiting", call: "", ts: 2000 }));
    // the permission notification carries no call of its own — the pending
    // PreToolUse call is what the user needs to see
    expect(s.snapshot()[0].call).toBe("Bash(npm test)");
  });

  it("reports whether anything actually changed", () => {
    const s = createStatusStore();
    expect(s.applyStatus(ev({ kind: "running", call: "Read(a.ts)" }))).toBe(
      true,
    );
    expect(s.applyStatus(ev({ kind: "running", call: "Read(a.ts)" }))).toBe(
      false,
    );
    expect(s.applyStatus(ev({ kind: "running", call: "Read(b.ts)" }))).toBe(
      true,
    );
  });

  it("reports change when session changes even if kind and call are identical", () => {
    const s = createStatusStore();
    expect(
      s.applyStatus(
        ev({ sessionId: "s1", kind: "running", call: "Read(a.ts)" }),
      ),
    ).toBe(true);
    expect(
      s.applyStatus(
        ev({ sessionId: "s1", kind: "running", call: "Read(a.ts)" }),
      ),
    ).toBe(false);
    expect(
      s.applyStatus(
        ev({ sessionId: "s2", kind: "running", call: "Read(a.ts)" }),
      ),
    ).toBe(true);
  });

  it("counts distinct read and edited files", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "running" }));
    s.countTool(tool({ nodeIds: ["a"] }));
    s.countTool(tool({ nodeIds: ["a"] })); // same file again — still 1
    s.countTool(tool({ nodeIds: ["b"] }));
    s.countTool(tool({ phase: "post", tool: "Edit", nodeIds: ["c"] }));
    expect(s.snapshot()[0]).toMatchObject({ reads: 2, edits: 1 });
  });

  it("a Grep match batch does not inflate the read count", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "running" }));
    s.countTool(
      tool({ phase: "post", tool: "Grep", nodeIds: ["x", "y", "z"] }),
    );
    expect(s.snapshot()[0].reads).toBe(0);
  });

  it("counts reset on a new prompt and on a new session", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "running" }));
    s.countTool(tool({ nodeIds: ["a"] }));
    s.countTool(tool({ tool: "Prompt", nodeIds: [] }));
    expect(s.snapshot()[0].reads).toBe(0);

    s.countTool(tool({ nodeIds: ["a"] }));
    s.countTool(tool({ sessionId: "s2", nodeIds: ["b"] }));
    expect(s.snapshot()[0].reads).toBe(1);
  });

  it("staleness demotes running to idle once past STALE_MS", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 0);
    s.applyStatus(ev({ kind: "running", ts: 1000 }));
    expect(s.sweep(1000 + STALE_MS - 1)).toBe(false);
    expect(kindOf(s)).toBe("running");
    expect(s.sweep(1000 + STALE_MS)).toBe(true);
    expect(kindOf(s)).toBe("idle");
    expect(s.sweep(1000 + STALE_MS * 3)).toBe(false); // already demoted
  });

  it("staleness never touches waiting — that is the state the user acts on", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 0);
    s.applyStatus(ev({ kind: "waiting", ts: 1000 }));
    expect(s.sweep(1000 + STALE_MS * 10)).toBe(false);
    expect(kindOf(s)).toBe("waiting");
  });

  it("a launched pty with no events yet is idle; exit forces none", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 500);
    expect(kindOf(s)).toBe("idle");
    s.applyStatus(ev({ kind: "running", ts: 600 }));
    expect(s.ptyExited("w1", 700)).toBe(true);
    expect(kindOf(s)).toBe("none");
  });

  it("a status event for a dead pty revives it — the user relaunched", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 0);
    s.ptyExited("w1", 500);
    s.applyStatus(ev({ kind: "running", ts: 900 }));
    expect(kindOf(s)).toBe("running");
  });

  it("keeps workspaces independent", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ workspaceId: "w1", kind: "waiting" }));
    s.applyStatus(ev({ workspaceId: "w2", kind: "running" }));
    expect(kindOf(s, "w1")).toBe("waiting");
    expect(kindOf(s, "w2")).toBe("running");
  });

  it("stamps since on every kind change, exit included", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 100);
    expect(s.snapshot()[0].since).toBe(100); // none -> idle

    s.applyStatus(ev({ kind: "running", ts: 200 }));
    expect(s.snapshot()[0].since).toBe(200); // idle -> running

    s.ptyExited("w1", 300);
    expect(kindOf(s)).toBe("none");
    expect(s.snapshot()[0].since).toBe(300); // running -> none
  });

  it("stores the message from a status event and clears it on session change", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "idle", message: "done!" }));
    expect(s.snapshot()[0].message).toBe("done!");
    s.applyStatus(ev({ kind: "running", sessionId: "s2", ts: 2000 }));
    expect(s.snapshot()[0].message).toBe("");
  });

  it("keeps the last message across a running event that carries none", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "idle", message: "answer me" }));
    s.applyStatus(ev({ kind: "running", ts: 2000 }));
    expect(s.snapshot()[0].message).toBe("answer me");
  });

  it("a changed message alone counts as a change", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "idle", message: "a" }));
    expect(s.applyStatus(ev({ kind: "idle", message: "b", ts: 2000 }))).toBe(
      true,
    );
  });
});
