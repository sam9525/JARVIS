import { describe, it, expect } from "vitest";
import { graphMetrics, nodeRadius } from "../src/renderer/graph-metrics";
import type { VaultGraph } from "../src/shared/types";

const g: VaultGraph = {
  nodes: [
    { id: "physics/raw/a", type: "note", domain: "physics", section: "raw" },
    { id: "physics/wiki/b", type: "note", domain: "physics", section: "wiki" },
    { id: "history/raw/c", type: "note", domain: "history", section: "raw" },
    { id: "lonely", type: "note" },
    { id: "tag:shared", type: "tag" },
  ],
  edges: [
    { source: "physics/raw/a", target: "physics/wiki/b" },
    { source: "physics/raw/a", target: "tag:shared" },
    { source: "history/raw/c", target: "physics/raw/a" },
  ],
};

describe("nodeRadius", () => {
  it("is 2 for degree 0 and grows with sqrt(degree)", () => {
    expect(nodeRadius(0)).toBe(2);
    expect(nodeRadius(1)).toBeCloseTo(3.5);
    expect(nodeRadius(4)).toBeCloseTo(5);
    expect(nodeRadius(9)).toBeCloseTo(6.5);
  });
});

describe("graphMetrics", () => {
  it("computes degree-based radius for every node", () => {
    const m = graphMetrics(g);
    expect(m.radius.get("physics/raw/a")).toBeCloseTo(nodeRadius(3));
    expect(m.radius.get("physics/wiki/b")).toBeCloseTo(nodeRadius(1));
    expect(m.radius.get("lonely")).toBe(2);
    expect(m.radius.size).toBe(g.nodes.length);
  });

  it("builds a bidirectional neighbor lookup with entries for every node", () => {
    const m = graphMetrics(g);
    expect([...(m.neighbors.get("physics/raw/a") ?? [])].sort()).toEqual([
      "history/raw/c",
      "physics/wiki/b",
      "tag:shared",
    ]);
    expect([...(m.neighbors.get("tag:shared") ?? [])]).toEqual(["physics/raw/a"]);
    expect(m.neighbors.get("lonely")?.size).toBe(0);
  });
});
