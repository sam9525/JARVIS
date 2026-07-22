import type { VaultGraph } from "../shared/types";

export function nodeRadius(degree: number): number {
  return 0.5 + 1 * Math.sqrt(degree);
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

export const HEAT_GROW = 0.8; // radius multiplier at full heat = 1.8×

// The one on-screen radius formula, shared by both views. Heat applies HERE and
// never on node.r — use-force-tuning feeds node.r to forceCollide, so writing
// heat into it would shove the layout every time a count ticks up.
export function displayRadius(
  base: number,
  nodeSize: number,
  heat: number,
): number {
  return base * nodeSize * (1 + HEAT_GROW * heat);
}

