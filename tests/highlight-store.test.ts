import { describe, it, expect } from "vitest";
import {
  applyEvent,
  emptyState,
  nodeDisplay,
  pulseProgress,
  resetHighlights,
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
});
