import { describe, it, expect } from "vitest";
import {
  foldTo,
  nextRev,
  appendEvent,
  chaptersOf,
  labelOf,
} from "../../src/renderer/session/replay";
import {
  applyEvent,
  emptyState,
  matchProgress,
  type HighlightState,
} from "../../src/renderer/session/highlight-store";
import type { ToolEvent } from "../../src/shared/types";

const ev = (over: Partial<ToolEvent>): ToolEvent => ({
  sessionId: "s1",
  workspaceId: "w1",
  phase: "pre",
  tool: "Read",
  nodeIds: [],
  ts: 0,
  ...over,
});

// everything a viewer can observe, minus rev/frozenAt which differ by design
const snap = (s: HighlightState) => ({
  sessionId: s.sessionId,
  nodes: [...s.nodes.entries()],
  trail: [...s.trail],
  matched: [...s.matched].sort(),
  heat: [...s.heat.entries()],
  pulseAt: s.pulseAt,
  matchAt: s.matchAt,
});

const LOG: ToolEvent[] = [
  ev({ tool: "Prompt" }),
  ev({ nodeIds: ["a"] }),
  ev({ tool: "Grep", phase: "pre", pattern: "foo" }),
  ev({ tool: "Grep", phase: "post", nodeIds: ["b", "c"] }),
  ev({ nodeIds: ["b"] }),
  ev({ tool: "Edit", phase: "post", nodeIds: ["a"] }),
  ev({ tool: "Prompt" }),
  ev({ nodeIds: ["c"] }),
  ev({ nodeIds: ["c"] }),
];

describe("foldTo", () => {
  it("every prefix fold equals applying those events incrementally", () => {
    // the feature's core correctness claim: replay runs the same reducer live
    // runs, so a folded past can never drift from what was actually shown
    const running = emptyState();
    for (let i = 0; i < LOG.length; i++) {
      applyEvent(running, LOG[i], i + 1);
      expect(snap(foldTo(LOG, i))).toEqual(snap(running));
    }
  });

  it("marks the folded state as parked on its index, 1-based", () => {
    expect(foldTo(LOG, 3).frozenAt).toBe(4);
    expect(foldTo(LOG, 0).frozenAt).toBe(1);
  });

  it("holds the match glow when parked on the search that produced it", () => {
    expect(matchProgress(foldTo(LOG, 3), 999999)).toBe(0);
    expect(matchProgress(foldTo(LOG, 4), 999999)).toBeNull();
  });

  it("clamps an out-of-range index instead of throwing", () => {
    expect(snap(foldTo(LOG, 999))).toEqual(snap(foldTo(LOG, LOG.length - 1)));
    expect(snap(foldTo(LOG, -5))).toEqual(snap(foldTo(LOG, 0)));
  });

  it("is unaffected by events appended after the folded index", () => {
    // the parked view must not move while Claude keeps working
    const growing = LOG.slice(0, 5);
    const before = snap(foldTo(growing, 2));
    growing.push(ev({ nodeIds: ["z"] }), ev({ tool: "Prompt" }));
    expect(snap(foldTo(growing, 2))).toEqual(before);
  });

  it("returns a blank, transient-free state for an empty log", () => {
    const s = foldTo([], 0);
    expect(s.nodes.size).toBe(0);
    expect(matchProgress(s, 999999)).toBeNull();
  });

  it("stamps a strictly increasing rev so a retarget always re-bakes", () => {
    const a = foldTo(LOG, 1).rev;
    const b = foldTo(LOG, 1).rev;
    expect(b).toBeGreaterThan(a);
    expect(nextRev()).toBeGreaterThan(b);
  });
});

describe("appendEvent", () => {
  it("appends within a session and keeps workspaces separate", () => {
    const logs = new Map<string, ToolEvent[]>();
    expect(appendEvent(logs, ev({ nodeIds: ["a"] }))).toBe(true); // first = fresh
    expect(appendEvent(logs, ev({ nodeIds: ["b"] }))).toBe(false);
    appendEvent(logs, ev({ workspaceId: "w2", nodeIds: ["z"] }));
    expect(logs.get("w1")!.length).toBe(2);
    expect(logs.get("w2")!.length).toBe(1);
  });

  it("wipes the log when the session changes", () => {
    const logs = new Map<string, ToolEvent[]>();
    appendEvent(logs, ev({ nodeIds: ["a"] }));
    appendEvent(logs, ev({ nodeIds: ["b"] }));
    expect(appendEvent(logs, ev({ sessionId: "s2", nodeIds: ["c"] }))).toBe(
      true,
    );
    expect(logs.get("w1")!.map((e) => e.nodeIds[0])).toEqual(["c"]);
  });

  it("keeps Prompt events — they are the chapter marks", () => {
    const logs = new Map<string, ToolEvent[]>();
    appendEvent(logs, ev({ nodeIds: ["a"] }));
    appendEvent(logs, ev({ tool: "Prompt" }));
    expect(logs.get("w1")!.length).toBe(2);
  });
});

describe("chaptersOf", () => {
  it("returns the indices of the Prompt events", () => {
    expect(chaptersOf(LOG)).toEqual([0, 6]);
  });

  it("returns nothing for a log with no prompts", () => {
    expect(chaptersOf([ev({ nodeIds: ["a"] })])).toEqual([]);
  });
});

describe("labelOf", () => {
  it("names a prompt as a divider", () => {
    expect(labelOf(ev({ tool: "Prompt" }))).toBe("— your message —");
  });

  it("quotes a search pattern", () => {
    expect(labelOf(ev({ tool: "Grep", pattern: "applyEvent" }))).toBe(
      'Grep "applyEvent"',
    );
  });

  it("names the single file a tool touched", () => {
    expect(labelOf(ev({ tool: "Read", nodeIds: ["src/main/index.ts"] }))).toBe(
      "Read src/main/index.ts",
    );
  });

  it("counts multiple files rather than listing them", () => {
    expect(
      labelOf(ev({ tool: "Grep", phase: "post", nodeIds: ["a", "b", "c"] })),
    ).toBe("Grep 3 files");
  });

  it("falls back to the bare tool name when there is nothing to name", () => {
    expect(labelOf(ev({ tool: "Glob" }))).toBe("Glob");
  });
});
