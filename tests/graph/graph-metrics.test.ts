import { describe, it, expect } from "vitest";
import {
  graphMetrics,
  nodeRadius,
  displayRadius,
  HEAT_GROW,
} from "../../src/renderer/graph/graph-metrics";
import type { VaultGraph } from "../../src/shared/types";

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
  it("is 0.5 for degree 0 and grows with sqrt(degree)", () => {
    expect(nodeRadius(0)).toBe(0.5);
    expect(nodeRadius(1)).toBeCloseTo(1.5);
    expect(nodeRadius(4)).toBeCloseTo(2.5);
    expect(nodeRadius(9)).toBeCloseTo(3.5);
  });
});

describe("graphMetrics", () => {
  it("computes degree-based radius for every node", () => {
    const m = graphMetrics(g);
    expect(m.radius.get("physics/raw/a")).toBeCloseTo(nodeRadius(3));
    expect(m.radius.get("physics/wiki/b")).toBeCloseTo(nodeRadius(1));
    expect(m.radius.get("lonely")).toBe(0.5);
    expect(m.radius.size).toBe(g.nodes.length);
  });

  it("builds a bidirectional neighbor lookup with entries for every node", () => {
    const m = graphMetrics(g);
    expect([...(m.neighbors.get("physics/raw/a") ?? [])].sort()).toEqual([
      "history/raw/c",
      "physics/wiki/b",
      "tag:shared",
    ]);
    expect([...(m.neighbors.get("tag:shared") ?? [])]).toEqual([
      "physics/raw/a",
    ]);
    expect(m.neighbors.get("lonely")?.size).toBe(0);
  });
});

describe("displayRadius", () => {
  it("is base × nodeSize when cold", () => {
    expect(displayRadius(1.5, 2, 0)).toBeCloseTo(3);
  });

  it("grows to 1.8× at full heat", () => {
    expect(HEAT_GROW).toBe(0.8);
    expect(displayRadius(1.5, 2, 1)).toBeCloseTo(3 * 1.8);
  });

  it("scales linearly in between", () => {
    expect(displayRadius(1.5, 2, 0.5)).toBeCloseTo(3 * 1.4);
  });
});
