import { describe, it, expect } from "vitest";
import {
  settleLayout,
  layoutFor,
  MINI_NODES,
} from "../src/renderer/mini-layout";
import type { VaultGraph } from "../src/shared/types";

// a hub-and-spoke graph: node "h0" is the highest-degree node by construction
const graph = (n: number): VaultGraph => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: i === 0 ? "h0" : `n${i}`,
    type: "note" as const,
  })),
  edges: Array.from({ length: n - 1 }, (_, i) => ({
    source: "h0",
    target: `n${i + 1}`,
  })),
});

describe("settleLayout", () => {
  it("returns every node when the graph is under the cap", () => {
    const l = settleLayout(graph(10), 200, 100);
    expect(l.nodes).toHaveLength(10);
  });

  it("caps at MINI_NODES, keeping the highest-degree nodes", () => {
    const l = settleLayout(graph(200), 200, 100);
    expect(l.nodes).toHaveLength(MINI_NODES);
    // the hub is connected to everything — it must survive the cull
    expect(l.nodes.some((n) => n.id === "h0")).toBe(true);
  });

  it("drops edges whose endpoints did not survive the cull", () => {
    const l = settleLayout(graph(200), 200, 100);
    for (const [a, b] of l.edges) {
      expect(l.nodes[a]).toBeDefined();
      expect(l.nodes[b]).toBeDefined();
    }
  });

  it("keeps every node inside the canvas bounds", () => {
    const l = settleLayout(graph(60), 200, 100);
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(200);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(100);
    }
  });

  it("is deterministic — the same graph settles identically", () => {
    const a = settleLayout(graph(30), 200, 100);
    const b = settleLayout(graph(30), 200, 100);
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(
      b.nodes.map((n) => [n.x, n.y]),
    );
  });

  it("gives higher-degree nodes a larger radius", () => {
    const l = settleLayout(graph(20), 200, 100);
    const radiusOf = (id: string) => l.nodes.find((n) => n.id === id)?.r ?? 0;
    expect(radiusOf("h0")).toBeGreaterThan(radiusOf("n5"));
  });

  it("handles an empty graph without throwing", () => {
    const l = settleLayout({ nodes: [], edges: [] }, 200, 100);
    expect(l.nodes).toEqual([]);
    expect(l.edges).toEqual([]);
  });

  it("ignores edges naming nodes that do not exist", () => {
    const g: VaultGraph = {
      nodes: [{ id: "a", type: "note" }],
      edges: [{ source: "a", target: "ghost" }],
    };
    expect(() => settleLayout(g, 200, 100)).not.toThrow();
    expect(settleLayout(g, 200, 100).edges).toEqual([]);
  });
});

describe("layoutFor caching", () => {
  it("returns the identical object for the same graph and size", () => {
    const g = graph(20);
    expect(layoutFor(g, 200, 100)).toBe(layoutFor(g, 200, 100));
  });

  it("re-settles when the size changes", () => {
    const g = graph(20);
    expect(layoutFor(g, 200, 100)).not.toBe(layoutFor(g, 300, 100));
  });

  it("treats a different graph object as a different graph", () => {
    expect(layoutFor(graph(20), 200, 100)).not.toBe(
      layoutFor(graph(20), 200, 100),
    );
  });
});
