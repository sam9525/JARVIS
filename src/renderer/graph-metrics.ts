import type { VaultGraph } from "../shared/types";

export function nodeRadius(degree: number): number {
  return 2 + 1.5 * Math.sqrt(degree);
}

export function graphMetrics(graph: VaultGraph): {
  radius: Map<string, number>;
  neighbors: Map<string, Set<string>>;
} {
  const neighbors = new Map<string, Set<string>>(
    graph.nodes.map((n) => [n.id, new Set<string>()]),
  );
  for (const e of graph.edges) {
    neighbors.get(e.source)?.add(e.target);
    neighbors.get(e.target)?.add(e.source);
  }
  const radius = new Map<string, number>(
    graph.nodes.map((n) => [n.id, nodeRadius(neighbors.get(n.id)?.size ?? 0)]),
  );
  return { radius, neighbors };
}
