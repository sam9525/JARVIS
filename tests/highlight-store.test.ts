import { describe, it, expect } from "vitest";
import {
  applyEvent,
  emptyState,
  nodeDisplay,
  pulseProgress,
  FLARE_MS,
  PULSE_MS,
} from "../src/renderer/highlight-store";
import type { ToolEvent } from "../src/shared/types";

const ev = (over: Partial<ToolEvent>): ToolEvent => ({
  sessionId: "s1",
  phase: "pre",
  tool: "Read",
  nodeIds: [],
  ts: 0,
  ...over,
});

describe("highlight-store", () => {
  it("read flare: bright under 2s, dim tint after", () => {
    const s = emptyState();
    applyEvent(s, ev({ tool: "Read", phase: "pre", nodeIds: ["a"] }), 1000);
    expect(nodeDisplay(s, "a", 1000 + FLARE_MS - 1)).toBe("read-bright");
    expect(nodeDisplay(s, "a", 1000 + FLARE_MS + 1)).toBe("read-dim");
  });

  it("modified sticks and is not downgraded by a later read", () => {
    const s = emptyState();
    applyEvent(s, ev({ tool: "Edit", phase: "post", nodeIds: ["a"] }), 0);
    applyEvent(s, ev({ tool: "Read", phase: "pre", nodeIds: ["a"] }), 10);
    expect(nodeDisplay(s, "a", 999_999)).toBe("modified");
  });

  it("search pulse progresses over PULSE_MS then ends", () => {
    const s = emptyState();
    applyEvent(s, ev({ tool: "Grep", phase: "pre", pattern: "x" }), 500);
    expect(pulseProgress(s, 800)).toBeCloseTo(300 / PULSE_MS);
    expect(pulseProgress(s, 500 + PULSE_MS)).toBeNull();
  });

  it("unknown node has no display state", () => {
    expect(nodeDisplay(emptyState(), "nope", 0)).toBeNull();
  });

  it("resets all highlights when a new session starts", () => {
    const s = emptyState();
    applyEvent(s, ev({ tool: "Edit", phase: "post", nodeIds: ["a"] }), 0);
    applyEvent(s, ev({ sessionId: "s2", tool: "Grep", phase: "pre" }), 1);
    expect(nodeDisplay(s, "a", 2)).toBeNull();
  });

  it("handles future event timestamps gracefully (clock drift / negative duration)", () => {
    const s = emptyState();
    applyEvent(s, ev({ tool: "Read", phase: "pre", nodeIds: ["a"] }), 1000);
    expect(nodeDisplay(s, "a", 500)).toBeNull();
  });

  it("handles future pulse timestamps gracefully (clock drift / negative duration)", () => {
    const s = emptyState();
    applyEvent(s, ev({ tool: "Grep", phase: "pre", pattern: "x" }), 1000);
    expect(pulseProgress(s, 500)).toBeNull();
  });
});
