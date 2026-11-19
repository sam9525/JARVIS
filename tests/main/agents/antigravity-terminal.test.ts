import { describe, expect, it } from "vitest";
import { createAntigravityTerminal } from "../../../src/main/agents/antigravity-terminal";
import type { RawHookEvent } from "../../../src/main/event-mapper";
import type { AgentId, StatusKind } from "../../../src/shared/types";

const READY = "\x07\x1b]9;Antigravity CLI is ready for input\x07";
const NEEDS = "\x07\x1b]9;Antigravity CLI needs tool confirmation\x07";

function setup(
  agent: AgentId | undefined,
  sessionId = "A",
  kind: StatusKind = "working",
) {
  const notes: Array<[string, string]> = [];
  const mapped: RawHookEvent[] = [];
  const terminal = createAntigravityTerminal({
    agentOf: () => agent,
    cwdOf: () => "C:\\work\\demo",
    sessionIdOf: () => sessionId,
    statusKindOf: () => kind,
    noteGate: (id, name) => notes.push([id, name]),
    map: (payload) => mapped.push(payload),
  });
  return { terminal, notes, mapped };
}

describe("antigravity terminal output", () => {
  it("maps a permission code without a gate note", () => {
    const s = setup("antigravity");
    s.terminal.output("k", NEEDS);
    expect(s.mapped).toHaveLength(1);
    expect(s.mapped[0]).toMatchObject({
      notification_type: "permission_prompt",
      jarvis_session: "k",
      session_id: "A",
      cwd: "C:\\work\\demo",
    });
    expect(s.notes).toEqual([]);
  });

  it("maps the ready code and notes Interrupt on the gate", () => {
    const s = setup("antigravity");
    s.terminal.output("k", READY);
    expect(s.mapped[0]?.notification_type).toBe("idle_prompt");
    expect(s.notes).toEqual([["k", "Interrupt"]]);
  });

  it("ignores the ready code while a permission prompt is open", () => {
    const s = setup("antigravity", "A", "blocked");
    s.terminal.output("k", READY);
    expect(s.mapped).toEqual([]);
    expect(s.notes).toEqual([]);
  });

  it("still maps a permission code while blocked", () => {
    const s = setup("antigravity", "A", "blocked");
    s.terminal.output("k", NEEDS);
    expect(s.mapped[0]?.notification_type).toBe("permission_prompt");
  });

  it.each(["working", "asking", "idle"] as const)(
    "maps the ready code while the status is %s",
    (kind) => {
      const s = setup("antigravity", "A", kind);
      s.terminal.output("k", READY);
      expect(s.mapped[0]?.notification_type).toBe("idle_prompt");
      expect(s.notes).toEqual([["k", "Interrupt"]]);
    },
  );

  it("ignores codes with texts agy does not send", () => {
    const s = setup("antigravity");
    s.terminal.output("k", "\x1b]9;Build finished\x07");
    expect(s.mapped).toEqual([]);
    expect(s.notes).toEqual([]);
  });

  it.each(["claude", "codex", undefined] as const)(
    "scans nothing for %s",
    (agent) => {
      const s = setup(agent);
      s.terminal.output("k", READY + NEEDS);
      expect(s.mapped).toEqual([]);
      expect(s.notes).toEqual([]);
    },
  );

  it("forget drops a code split across chunks", () => {
    const s = setup("antigravity");
    const cut = READY.length - 10;
    s.terminal.output("k", READY.slice(0, cut));
    s.terminal.forget("k");
    s.terminal.output("k", READY.slice(cut));
    expect(s.mapped).toEqual([]);
  });

  it("joins a split code when nothing forgets it", () => {
    const s = setup("antigravity");
    const cut = READY.length - 10;
    s.terminal.output("k", READY.slice(0, cut));
    s.terminal.output("k", READY.slice(cut));
    expect(s.mapped).toHaveLength(1);
  });
});

describe("antigravity terminal keys", () => {
  it("notes Interrupt for an Esc that ended a prompt", () => {
    const s = setup("antigravity");
    s.terminal.keyed("k", "\x1b", true);
    expect(s.notes).toEqual([["k", "Interrupt"]]);
  });

  it("notes nothing for an Esc that ended no prompt", () => {
    const s = setup("antigravity");
    s.terminal.keyed("k", "\x1b", false);
    expect(s.notes).toEqual([]);
  });

  it("notes nothing for any key but a lone Esc", () => {
    const s = setup("antigravity");
    s.terminal.keyed("k", "\r", true);
    s.terminal.keyed("k", "1", true);
    s.terminal.keyed("k", "\x1b[A", true);
    expect(s.notes).toEqual([]);
  });

  it.each(["claude", "codex", undefined] as const)(
    "notes nothing for %s",
    (agent) => {
      const s = setup(agent);
      s.terminal.keyed("k", "\x1b", true);
      expect(s.notes).toEqual([]);
    },
  );
});
