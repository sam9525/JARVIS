import { describe, it, expect } from "vitest";
import {
  capped,
  SYMBOL_NODE_CAP,
} from "../../src/renderer/graph/use-workspace-graphs";
import type { VaultGraph } from "../../src/shared/types";

// a star: hub links to every leaf, so `busiest` has a clear ranking to trim by
function star(nodeCount: number): VaultGraph {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    type: "file" as const,
  }));
  return {
    nodes,
    edges: nodes.slice(1).map((n) => ({ source: "n0", target: n.id })),
  };
}

describe("capped", () => {
  it("passes an at-cap graph through untouched", () => {
    const g = star(SYMBOL_NODE_CAP);
    expect(capped(g)).toBe(g); // same object — no needless re-layout
  });

  it("trims one node over the cap", () => {
    const g = star(SYMBOL_NODE_CAP + 1);
    const out = capped(g);
    expect(out).not.toBe(g);
    expect(out.nodes.length).toBe(SYMBOL_NODE_CAP);
  });

  it("keeps the busiest nodes when it trims", () => {
    const out = capped(star(SYMBOL_NODE_CAP + 50));
    expect(out.nodes.some((n) => n.id === "n0")).toBe(true); // the hub survives
  });

  it("leaves a small graph — JARVIS-sized — alone", () => {
    const g = star(386);
    expect(capped(g)).toBe(g);
  });
});
