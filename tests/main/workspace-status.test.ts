import { describe, it, expect } from "vitest";
import {
  createStatusStore,
  STALE_MS,
  EXPIRE_MS,
} from "../../src/main/workspace-status";
import type { StatusEvent, ToolEvent } from "../../src/shared/types";

const ev = (over: Partial<StatusEvent>): StatusEvent => ({
  workspaceId: "w1",
  sessionKey: "w1",
  sessionId: "s1",
  kind: "working",
  call: "",
  ts: 1000,
  ...over,
});

const tool = (over: Partial<ToolEvent>): ToolEvent => ({
  sessionId: "s1",
  workspaceId: "w1",
  sessionKey: "w1",
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
    s.applyStatus(ev({ kind: "working", call: "Bash(npm test)", ts: 5000 }));
    expect(s.snapshot()[0]).toMatchObject({
      workspaceId: "w1",
      kind: "working",
      call: "Bash(npm test)",
      since: 5000,
    });
  });

  it("working → blocked → idle", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "working" }));
    expect(kindOf(s)).toBe("working");
    s.applyStatus(ev({ kind: "blocked", ts: 2000 }));
    expect(kindOf(s)).toBe("blocked");
    s.applyStatus(ev({ kind: "idle", ts: 3000 }));
    expect(kindOf(s)).toBe("idle");
  });

  it("a blocked workspace keeps the call line that caused the prompt", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "working", call: "Bash(npm test)" }));
    s.applyStatus(ev({ kind: "blocked", call: "", ts: 2000 }));
    // the permission notification carries no call of its own — the pending
    // PreToolUse call is what the user needs to see
    expect(s.snapshot()[0].call).toBe("Bash(npm test)");
  });

  it("reports whether anything actually changed", () => {
    const s = createStatusStore();
    expect(s.applyStatus(ev({ kind: "working", call: "Read(a.ts)" }))).toBe(
      true,
    );
    expect(s.applyStatus(ev({ kind: "working", call: "Read(a.ts)" }))).toBe(
      false,
    );
    expect(s.applyStatus(ev({ kind: "working", call: "Read(b.ts)" }))).toBe(
      true,
    );
  });

  it("reports change when session changes even if kind and call are identical", () => {
    const s = createStatusStore();
    expect(
      s.applyStatus(
        ev({ sessionId: "s1", kind: "working", call: "Read(a.ts)" }),
      ),
    ).toBe(true);
    expect(
      s.applyStatus(
        ev({ sessionId: "s1", kind: "working", call: "Read(a.ts)" }),
      ),
    ).toBe(false);
    expect(
      s.applyStatus(
        ev({ sessionId: "s2", kind: "working", call: "Read(a.ts)" }),
      ),
    ).toBe(true);
  });

  it("counts distinct read and edited files", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "working" }));
    s.countTool(tool({ nodeIds: ["a"] }));
    s.countTool(tool({ nodeIds: ["a"] })); // same file again — still 1
    s.countTool(tool({ nodeIds: ["b"] }));
    s.countTool(tool({ phase: "post", tool: "Edit", nodeIds: ["c"] }));
    expect(s.snapshot()[0]).toMatchObject({ reads: 2, edits: 1 });
  });

  it("a Grep match batch does not inflate the read count", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "working" }));
    s.countTool(
      tool({ phase: "post", tool: "Grep", nodeIds: ["x", "y", "z"] }),
    );
    expect(s.snapshot()[0].reads).toBe(0);
  });

  it("counts reset on a new prompt and on a new session", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "working" }));
    s.countTool(tool({ nodeIds: ["a"] }));
    s.countTool(tool({ tool: "Prompt", nodeIds: [] }));
    expect(s.snapshot()[0].reads).toBe(0);

    s.countTool(tool({ nodeIds: ["a"] }));
    s.countTool(tool({ sessionId: "s2", nodeIds: ["b"] }));
    expect(s.snapshot()[0].reads).toBe(1);
  });

  it("staleness demotes working to idle once past STALE_MS", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 0);
    s.applyStatus(ev({ kind: "working", ts: 1000 }));
    expect(s.sweep(1000 + STALE_MS - 1)).toBe(false);
    expect(kindOf(s)).toBe("working");
    expect(s.sweep(1000 + STALE_MS)).toBe(true);
    expect(kindOf(s)).toBe("idle");
    expect(s.sweep(1000 + STALE_MS * 3)).toBe(false); // already demoted
  });

  it("staleness never touches blocked — that is the state the user acts on", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 0);
    s.applyStatus(ev({ kind: "blocked", ts: 1000 }));
    expect(s.sweep(1000 + STALE_MS * 10)).toBe(false);
    expect(kindOf(s)).toBe("blocked");
  });

  it("a launched pty with no events yet is idle; exit forces none", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 500);
    expect(kindOf(s)).toBe("idle");
    s.applyStatus(ev({ kind: "working", ts: 600 }));
    expect(s.ptyExited("w1", 700, 0)).toBe(true);
    expect(kindOf(s)).toBe("none");
  });

  // a `claude` run by hand in the same folder posts hooks under this
  // workspace's id; the panel would hide its launch overlay over a pty that
  // does not exist and leave the user a terminal nothing can type into
  it("keeps live to our own pty — a hook event alone never sets it", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "working", ts: 100 }));
    expect(s.snapshot()[0].live).toBe(false);
    s.countTool(tool({ nodeIds: ["a"] }));
    expect(s.snapshot()[0].live).toBe(false);
    s.ptyLaunched("w1", 200);
    expect(s.snapshot()[0].live).toBe(true);
  });

  // the terminal panel reads `live` to know about a session main launched
  it("reports liveness, and pushes the flip even when the kind cannot say it", () => {
    const s = createStatusStore();
    s.restore([{ workspaceId: "w1", message: "done", since: 0 }]);
    expect(s.snapshot()[0].live).toBe(false); // restored row: idle, no terminal
    expect(s.ptyLaunched("w1", 100)).toBe(true); // idle already — only live moved
    expect(s.snapshot()[0].live).toBe(true);
    expect(s.ptyLaunched("w1", 200)).toBe(false); // already live
    s.ptyExited("w1", 300, 0);
    expect(s.snapshot()[0].live).toBe(false);
  });

  it("a status event for a dead pty revives it — the user relaunched", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 0);
    s.ptyExited("w1", 500, 0);
    s.applyStatus(ev({ kind: "working", ts: 900 }));
    expect(kindOf(s)).toBe("working");
  });

  it("keeps workspaces independent", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ workspaceId: "w1", kind: "blocked" }));
    s.applyStatus(ev({ workspaceId: "w2", sessionKey: "w2", kind: "working" }));
    expect(kindOf(s, "w1")).toBe("blocked");
    expect(kindOf(s, "w2")).toBe("working");
  });

  it("stamps since on every kind change, exit included", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 100);
    expect(s.snapshot()[0].since).toBe(100); // none -> idle

    s.applyStatus(ev({ kind: "working", ts: 200 }));
    expect(s.snapshot()[0].since).toBe(200); // idle -> working

    s.ptyExited("w1", 300, 0);
    expect(kindOf(s)).toBe("none");
    expect(s.snapshot()[0].since).toBe(300); // working -> none
  });

  it("stores the message from a status event and clears it on session change", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "idle", message: "done!" }));
    expect(s.snapshot()[0].message).toBe("done!");
    s.applyStatus(ev({ kind: "working", sessionId: "s2", ts: 2000 }));
    expect(s.snapshot()[0].message).toBe("");
  });

  // a second `claude` in the same folder resolves to the same workspace, and
  // Claude's own idle Notification arrives ~60s after a turn ends — neither is
  // work starting, so neither may blank what the last session said
  it("keeps the message when an unfamiliar session only goes idle", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "idle", message: "done!" }));
    s.applyStatus(ev({ kind: "idle", sessionId: "other", ts: 61000 }));
    expect(s.snapshot()[0].message).toBe("done!");

    // ...and the next real prompt in that session still clears it
    s.applyStatus(ev({ kind: "working", sessionId: "other", ts: 62000 }));
    expect(s.snapshot()[0].message).toBe("");
  });

  it("keeps the last message across a working event that carries none", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "idle", message: "answer me" }));
    s.applyStatus(ev({ kind: "working", ts: 2000 }));
    expect(s.snapshot()[0].message).toBe("answer me");
  });

  // "all good" twice is two answers, not one: the stamp is what lets the
  // mouth tell a repeated reply from the same reply pushed again
  it("stamps messageAt with each Stop, even when the text repeats", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "idle", message: "all good", ts: 1000 }));
    expect(s.snapshot()[0].messageAt).toBe(1000);
    s.applyStatus(ev({ kind: "working", ts: 2000 }));
    expect(s.snapshot()[0].messageAt).toBe(1000);
    expect(
      s.applyStatus(ev({ kind: "idle", message: "all good", ts: 3000 })),
    ).toBe(true);
    expect(s.snapshot()[0].messageAt).toBe(3000);
  });

  it("a changed message alone counts as a change", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "idle", message: "a" }));
    expect(s.applyStatus(ev({ kind: "idle", message: "b", ts: 2000 }))).toBe(
      true,
    );
  });

  it("markDelegated surfaces the delegator in the snapshot", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "working" }));
    expect(s.markDelegated("w1", "JARVIS", 2000)).toBe(true);
    expect(s.markDelegated("w1", "JARVIS", 2100)).toBe(false); // no change
    expect(s.snapshot()[0].delegatedBy).toBe("JARVIS");
  });

  it("delegatedBy survives status updates within the same session", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "working" }));
    s.markDelegated("w1", "JARVIS", 2000);
    s.applyStatus(ev({ kind: "blocked", ts: 3000 }));
    s.applyStatus(ev({ kind: "idle", ts: 4000, message: "done" }));
    expect(s.snapshot()[0].delegatedBy).toBe("JARVIS");
  });

  it("delegatedBy clears when a new session starts", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "working" }));
    s.markDelegated("w1", "JARVIS", 2000);
    // the old session acts after the mark, so the mark belongs to it
    s.applyStatus(ev({ kind: "idle", ts: 3000, message: "done" }));
    s.applyStatus(ev({ sessionId: "s2", kind: "working", ts: 5000 }));
    expect(s.snapshot()[0].delegatedBy).toBe("");
  });

  // a fresh send types /clear, which starts a new session id, then marks the
  // delegation before the delegate's first prompt arrives under that new id
  it("delegatedBy survives the session a fresh send starts", () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "idle", ts: 1000, message: "old" }));
    s.markDelegated("w1", "JARVIS", 2000);
    s.applyStatus(ev({ sessionId: "s2", kind: "working", ts: 2500 }));
    expect(s.snapshot()[0].delegatedBy).toBe("JARVIS");
    // the next session change is not the one the mark was made for
    s.applyStatus(ev({ sessionId: "s3", kind: "working", ts: 9000 }));
    expect(s.snapshot()[0].delegatedBy).toBe("");
  });
});

describe("status store restore", () => {
  it("brings back the last message as an idle workspace", () => {
    const s = createStatusStore();
    s.restore([{ workspaceId: "w1", message: "answer me", since: 4000 }]);
    expect(s.snapshot()[0]).toMatchObject({
      workspaceId: "w1",
      kind: "idle",
      message: "answer me",
      messageAt: 4000,
      since: 4000,
      reads: 0,
      edits: 0,
    });
  });

  it("drops entries with no message, and survives garbage", () => {
    const s = createStatusStore();
    s.restore([{ workspaceId: "w1", message: "" }, { message: "no id" }, 7]);
    s.restore("not an array");
    s.restore(null);
    expect(s.snapshot()).toEqual([]);
  });

  it("a live session overwrites what was restored", () => {
    const s = createStatusStore();
    s.restore([{ workspaceId: "w1", message: "stale", since: 1 }]);
    s.applyStatus(ev({ kind: "working", call: "Bash(ls)", ts: 9000 }));
    expect(s.snapshot()[0]).toMatchObject({
      kind: "working",
      call: "Bash(ls)",
      message: "", // a new session id clears the restored message
    });
  });
});

describe("status store expiry", () => {
  // an idle workspace whose terminal has closed — the common expirable shape
  const dead = () => {
    const s = createStatusStore();
    s.applyStatus(ev({ kind: "idle", message: "done", ts: 1000 }));
    s.ptyExited("w1", 1000, 0);
    return s;
  };

  it("expires a dead-pty entry once past EXPIRE_MS — the whole row goes", () => {
    const s = dead();
    expect(s.sweep(1000 + EXPIRE_MS)).toBe(true);
    expect(s.snapshot()).toEqual([]);
  });

  it("does not expire at EXPIRE_MS - 1, and a no-op sweep returns false", () => {
    const s = dead();
    expect(s.sweep(1000 + EXPIRE_MS - 1)).toBe(false);
    expect(s.snapshot()).toHaveLength(1);
    expect(s.sweep(1000 + EXPIRE_MS)).toBe(true);
  });

  it("keeps an entry with a live terminal no matter how long it is quiet", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 0);
    s.applyStatus(ev({ kind: "idle", ts: 1000 }));
    expect(s.sweep(1000 + EXPIRE_MS * 10)).toBe(false);
    expect(kindOf(s)).toBe("idle");
  });

  // the row survives the quiet; "Claude said" six hours ago does not
  it("clears a live workspace's message once past EXPIRE_MS", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 0);
    s.applyStatus(ev({ kind: "idle", message: "done", ts: 1000 }));
    s.markDelegated("w1", "orchestrator", 1000);
    expect(s.sweep(1000 + EXPIRE_MS - 1)).toBe(false);
    expect(s.snapshot()[0].message).toBe("done");

    expect(s.sweep(1000 + EXPIRE_MS)).toBe(true);
    expect(s.snapshot()[0]).toMatchObject({
      workspaceId: "w1",
      kind: "idle",
      message: "",
      delegatedBy: "",
    });
    expect(s.sweep(1000 + EXPIRE_MS * 2)).toBe(false); // already cleared
  });

  // the restored timestamp belongs to the message, not to the session about to
  // start — launching a terminal must not hand the sweep an expired clock
  it("launching a terminal restarts a restored row's expiry clock", () => {
    const s = createStatusStore();
    s.restore([{ workspaceId: "w1", message: "answer me", since: 0 }]);
    s.ptyLaunched("w1", EXPIRE_MS);
    expect(s.sweep(EXPIRE_MS + 1000)).toBe(false);
    expect(s.snapshot()[0].message).toBe("answer me");
  });

  it("a restored row older than EXPIRE_MS is gone after one sweep", () => {
    const s = createStatusStore();
    s.restore([{ workspaceId: "w1", message: "old news", since: 0 }]);
    expect(s.sweep(EXPIRE_MS)).toBe(true);
    expect(s.snapshot()).toEqual([]);
  });

  it("an expired workspace reappears with correct state on a later event", () => {
    const s = dead();
    s.sweep(1000 + EXPIRE_MS);
    s.applyStatus(
      ev({ kind: "working", call: "Read(a.ts)", ts: 2000 + EXPIRE_MS }),
    );
    expect(s.snapshot()[0]).toMatchObject({
      workspaceId: "w1",
      kind: "working",
      call: "Read(a.ts)",
      message: "", // forgetting, not tombstoning — the row is brand new
      reads: 0,
    });
  });
});

describe("crashed", () => {
  it("reports a clean exit as none", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 1000);
    s.ptyExited("w1", 2000, 0);
    const row = s.snapshot().find((r) => r.workspaceId === "w1");
    expect(row?.kind).toBe("none");
  });

  it("reports a non-zero exit as crashed", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 1000);
    s.ptyExited("w1", 2000, 1);
    const row = s.snapshot().find((r) => r.workspaceId === "w1");
    expect(row?.kind).toBe("crashed");
  });

  it("keeps the last message through a crash", () => {
    const s = createStatusStore();
    s.ptyLaunched("w1", 1000);
    s.applyStatus({
      workspaceId: "w1",
      sessionKey: "w1",
      sessionId: "s1",
      kind: "working",
      call: "",
      ts: 1100,
    });
    s.applyStatus({
      workspaceId: "w1",
      sessionKey: "w1",
      sessionId: "s1",
      kind: "idle",
      call: "",
      message: "done",
      ts: 1200,
    });
    s.ptyExited("w1", 2000, 137);
    const row = s.snapshot().find((r) => r.workspaceId === "w1");
    expect(row?.kind).toBe("crashed");
    expect(row?.message).toBe("done");
  });

  it("never promotes a stale working session to asking", () => {
    const s = createStatusStore();
    s.applyStatus({
      workspaceId: "w1",
      sessionKey: "w1",
      sessionId: "s1",
      kind: "working",
      call: "Read(a.md)",
      ts: 1000,
    });
    s.sweep(1000 + STALE_MS);
    const row = s.snapshot().find((r) => r.workspaceId === "w1");
    expect(row?.kind).toBe("idle");
  });

  describe("sessions", () => {
    const sess = (label: string) => ({
      sessionKey: label === "main" ? "d:/r" : `d:/r#${label}`,
      workspaceId: "d:/r",
    });

    it("one row per workspace: the most urgent session sets the row", () => {
      const s = createStatusStore();
      s.applyStatus(
        ev({ ...sess("main"), kind: "asking", call: "Ask(x)", ts: 2000 }),
      );
      s.markDelegated("d:/r", "orch", 2500);
      s.applyStatus(
        ev({ ...sess("1"), kind: "working", call: "Bash(y)", ts: 3000 }),
      );
      const rows = s.snapshot();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        workspaceId: "d:/r",
        kind: "asking",
        call: "Ask(x)",
        delegatedBy: "orch",
        since: 2000,
      });
      expect(rows[0].sessions.map((x) => [x.key, x.label, x.kind])).toEqual([
        ["d:/r", "main", "asking"],
        ["d:/r#1", "1", "working"],
      ]);
    });

    it("a later session can be the more urgent one", () => {
      const s = createStatusStore();
      s.applyStatus(ev({ ...sess("main"), kind: "working", ts: 1000 }));
      s.applyStatus(
        ev({ ...sess("1"), kind: "asking", call: "Ask(z)", ts: 2000 }),
      );
      s.markDelegated("d:/r#1", "orch", 2500);
      expect(s.snapshot()[0]).toMatchObject({
        kind: "asking",
        call: "Ask(z)",
        delegatedBy: "orch",
        since: 2000,
      });
    });

    it("blocked outranks working", () => {
      const s = createStatusStore();
      s.applyStatus(ev({ ...sess("main"), kind: "working", ts: 1000 }));
      s.applyStatus(
        ev({ ...sess("2"), kind: "blocked", call: "Bash(rm)", ts: 2000 }),
      );
      expect(s.snapshot()[0]).toMatchObject({
        kind: "blocked",
        call: "Bash(rm)",
        since: 2000,
      });
    });

    it("a workspace id holding # keeps its own id from a bare key", () => {
      const s = createStatusStore(() => ["d:/c#proj"]);
      s.ptyLaunched("d:/c#proj", 1000);
      const row = s.snapshot()[0];
      expect(row.workspaceId).toBe("d:/c#proj");
      expect(row.sessions[0].label).toBe("main");
    });

    it("an event's owner corrects an entry made from a bare key", () => {
      const s = createStatusStore();
      s.ptyLaunched("d:/c#proj", 1000);
      s.applyStatus(
        ev({ workspaceId: "d:/c#proj", sessionKey: "d:/c#proj", ts: 2000 }),
      );
      expect(s.snapshot().map((r) => r.workspaceId)).toEqual(["d:/c#proj"]);
    });

    it("the message comes from the session that spoke last", () => {
      const s = createStatusStore();
      s.applyStatus(
        ev({ ...sess("1"), kind: "idle", message: "new", ts: 2000 }),
      );
      s.applyStatus(
        ev({ ...sess("main"), kind: "idle", message: "old", ts: 1000 }),
      );
      expect(s.snapshot()[0]).toMatchObject({
        message: "new",
        messageAt: 2000,
      });
    });

    it("sums counts, and is live if any session is", () => {
      const s = createStatusStore();
      s.countTool(tool({ ...sess("main"), nodeIds: ["a"] }));
      s.countTool(tool({ ...sess("1"), nodeIds: ["b", "c"] }));
      s.ptyLaunched("d:/r#1", 1000);
      const row = s.snapshot()[0];
      expect(row.reads).toBe(3);
      expect(row.live).toBe(true);
      expect(row.sessions.find((x) => x.label === "main")?.live).toBe(false);
    });

    it("sessionOpened records the worktree flag", () => {
      const s = createStatusStore();
      s.ptyLaunched("d:/r#2", 1000);
      expect(s.sessionOpened("d:/r#2", true, 1000)).toBe(true);
      expect(s.snapshot()[0].sessions[0]).toMatchObject({
        label: "2",
        worktree: true,
      });
    });

    it("sessionId is per session", () => {
      const s = createStatusStore();
      s.applyStatus(ev({ ...sess("main"), sessionId: "a" }));
      s.applyStatus(ev({ ...sess("1"), sessionId: "b" }));
      expect(s.sessionId("d:/r")).toBe("a");
      expect(s.sessionId("d:/r#1")).toBe("b");
    });

    it("shows a set topic on the session row", () => {
      const s = createStatusStore(() => ["w"]);
      s.sessionOpened("w#first", true, 1);
      expect(s.setTopic("w#first", "review")).toBe(true);
      expect(s.snapshot()[0].sessions[0].topic).toBe("review");
      expect(s.setTopic("w#first", "review")).toBe(false);
    });

    it("forgets the topic when the label is opened again", () => {
      const s = createStatusStore(() => ["w"]);
      s.sessionOpened("w#first", true, 1);
      s.setTopic("w#first", "review");
      s.sessionOpened("w#first", true, 2);
      expect(s.snapshot()[0].sessions[0]).not.toHaveProperty("topic");
    });

    it("restore puts a saved row on the workspace's main session", () => {
      const s = createStatusStore();
      s.restore([{ workspaceId: "d:/r", message: "hi", since: 500 }]);
      const row = s.snapshot()[0];
      expect(row).toMatchObject({ workspaceId: "d:/r", message: "hi" });
      expect(row.sessions.map((x) => x.key)).toEqual(["d:/r"]);
    });
  });
});
