import { describe, it, expect } from "vitest";
import {
  applyEvent,
  emptyState,
  expireMatches,
  matchProgress,
  nodeDisplay,
  pulseProgress,
  resetHighlights,
  MATCH_MS,
  PULSE_MS,
} from "../src/renderer/highlight-store";
import type { ToolEvent } from "../src/shared/types";

const ev = (over: Partial<ToolEvent>): ToolEvent => ({
  sessionId: "s1",
  workspaceId: "w1",
  phase: "pre",
  tool: "Read",
  nodeIds: [],
  ts: 0,
  ...over,
});

describe("highlight-store", () => {
  it("a read shows a persistent ring (no time-based fade)", () => {
    const s = emptyState();
    applyEvent(s, ev({ nodeIds: ["a"] }), 1000);
    expect(nodeDisplay(s, "a")).toBe("ring");
  });

  it("modified sticks and is not downgraded by a later read", () => {
    const s = emptyState();
    applyEvent(s, ev({ tool: "Edit", phase: "post", nodeIds: ["a"] }), 0);
    applyEvent(s, ev({ nodeIds: ["a"] }), 10);
    expect(nodeDisplay(s, "a")).toBe("modified");
  });

  it("reads build an ordered trail, skipping consecutive duplicates", () => {
    const s = emptyState();
    applyEvent(s, ev({ nodeIds: ["a"] }), 0);
    applyEvent(s, ev({ nodeIds: ["a"] }), 1); // consecutive dup — skipped
    applyEvent(s, ev({ nodeIds: ["b"] }), 2);
    applyEvent(s, ev({ nodeIds: ["a"] }), 3); // revisit — appended
    expect(s.trail).toEqual(["a", "b", "a"]);
  });

  it("a Prompt event resets rings, trail and pulse", () => {
    const s = emptyState();
    applyEvent(s, ev({ nodeIds: ["a"] }), 0);
    applyEvent(s, ev({ tool: "Grep", pattern: "x" }), 1);
    applyEvent(s, ev({ tool: "Prompt" }), 2);
    expect(nodeDisplay(s, "a")).toBeNull();
    expect(s.trail).toEqual([]);
    expect(pulseProgress(s, 3)).toBeNull();
  });

  it("resets all highlights when a new session starts", () => {
    const s = emptyState();
    applyEvent(s, ev({ tool: "Edit", phase: "post", nodeIds: ["a"] }), 0);
    applyEvent(s, ev({ sessionId: "s2", tool: "Grep" }), 1);
    expect(nodeDisplay(s, "a")).toBeNull();
    expect(s.trail).toEqual([]);
  });

  it("resetHighlights clears everything and bumps rev", () => {
    const s = emptyState();
    applyEvent(s, ev({ nodeIds: ["a"] }), 0);
    const rev = s.rev;
    resetHighlights(s);
    expect(s.nodes.size).toBe(0);
    expect(s.trail).toEqual([]);
    expect(s.pulseAt).toBe(0);
    expect(s.rev).toBeGreaterThan(rev);
  });

  it("rev increments on every applied event", () => {
    const s = emptyState();
    const r0 = s.rev;
    applyEvent(s, ev({ nodeIds: ["a"] }), 0);
    expect(s.rev).toBeGreaterThan(r0);
  });

  it("search pulse progresses over PULSE_MS then ends", () => {
    const s = emptyState();
    applyEvent(s, ev({ tool: "Grep", pattern: "x" }), 500);
    expect(pulseProgress(s, 800)).toBeCloseTo(300 / PULSE_MS);
    expect(pulseProgress(s, 500 + PULSE_MS)).toBeNull();
  });

  it("unknown node has no display state", () => {
    expect(nodeDisplay(emptyState(), "nope")).toBeNull();
  });

  it("handles future pulse timestamps gracefully (clock drift)", () => {
    const s = emptyState();
    applyEvent(s, ev({ tool: "Grep", pattern: "x" }), 1000);
    expect(pulseProgress(s, 500)).toBeNull();
  });

  it("stores are independent — events in one workspace never touch another", () => {
    const a = emptyState();
    const b = emptyState();
    applyEvent(
      a,
      {
        sessionId: "s",
        workspaceId: "wa",
        phase: "pre",
        tool: "Read",
        nodeIds: ["x"],
        ts: 0,
      },
      100,
    );
    resetHighlights(a);
    expect(b.nodes.size).toBe(0);
    expect(b.rev).toBe(0); // untouched by a's event and reset
  });

  it("a post Grep marks its nodes matched without touching rings or trail", () => {
    const s = emptyState();
    applyEvent(
      s,
      ev({ phase: "post", tool: "Grep", nodeIds: ["a", "b"] }),
      1000,
    );
    expect([...s.matched]).toEqual(["a", "b"]);
    expect(s.matchAt).toBe(1000);
    // matched is not a tier — no ring, no trail entry
    expect(nodeDisplay(s, "a")).toBeNull();
    expect(s.trail).toEqual([]);
  });

  it("a new search replaces the previous match batch", () => {
    const s = emptyState();
    applyEvent(s, ev({ phase: "post", tool: "Grep", nodeIds: ["a"] }), 0);
    applyEvent(s, ev({ phase: "post", tool: "Glob", nodeIds: ["b"] }), 500);
    expect([...s.matched]).toEqual(["b"]);
    expect(s.matchAt).toBe(500);
  });

  it("matchProgress runs 0→1 then returns null once expired", () => {
    const s = emptyState();
    applyEvent(s, ev({ phase: "post", tool: "Grep", nodeIds: ["a"] }), 1000);
    expect(matchProgress(s, 1000)).toBeCloseTo(0);
    expect(matchProgress(s, 1000 + MATCH_MS / 2)).toBeCloseTo(0.5);
    expect(matchProgress(s, 1000 + MATCH_MS)).toBeNull();
  });

  it("matchProgress is null when nothing has matched", () => {
    expect(matchProgress(emptyState(), 5000)).toBeNull();
  });

  it("expireMatches clears the batch once, and reports whether it did", () => {
    const s = emptyState();
    applyEvent(s, ev({ phase: "post", tool: "Grep", nodeIds: ["a"] }), 0);
    const revBefore = s.rev;
    expect(expireMatches(s, MATCH_MS - 1)).toBe(false);
    expect(s.matched.size).toBe(1);
    expect(expireMatches(s, MATCH_MS)).toBe(true);
    expect(s.matched.size).toBe(0);
    expect(s.rev).toBeGreaterThan(revBefore);
    expect(expireMatches(s, MATCH_MS + 1000)).toBe(false); // already clear
  });

  it("a matched node still gets a normal ring and trail entry when read", () => {
    const s = emptyState();
    applyEvent(s, ev({ phase: "post", tool: "Grep", nodeIds: ["a"] }), 0);
    applyEvent(s, ev({ nodeIds: ["a"] }), 100);
    expect(nodeDisplay(s, "a")).toBe("ring");
    expect(s.trail).toEqual(["a"]);
  });

  it("a new prompt clears matches along with everything else", () => {
    const s = emptyState();
    applyEvent(s, ev({ phase: "post", tool: "Grep", nodeIds: ["a"] }), 0);
    applyEvent(s, ev({ tool: "Prompt", nodeIds: [] }), 10);
    expect(s.matched.size).toBe(0);
    expect(s.matchAt).toBe(0);
  });
});
