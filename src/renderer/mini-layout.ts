import type { VaultGraph } from "../shared/types";
import { graphMetrics } from "./graph-metrics";

// A thumbnail settles once and then freezes — the app's graph is static and
// activity is a highlight layer, so nothing here needs to keep simulating.
export const SETTLE_TICKS = 120;
// The settle is O(n²) per tick. A 500-node vault graph uncapped would be ~30M
// operations per card, and at thumbnail scale those nodes are invisible, so
// each card shows only its most connected neighbourhood.
export const MINI_NODES = 60;

export interface MiniNode {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface MiniLayout {
  nodes: MiniNode[];
  edges: [number, number][]; // index pairs into nodes
}

// deterministic PRNG — the same graph must settle to the same picture every
// time, or a card would jump every time the home screen reopens
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function settleLayout(
  graph: VaultGraph,
  w: number,
  h: number,
): MiniLayout {
  const { radius, neighbors } = graphMetrics(graph);

  const kept = [...graph.nodes]
    .sort(
      (a, b) =>
        (neighbors.get(b.id)?.size ?? 0) - (neighbors.get(a.id)?.size ?? 0),
    )
    .slice(0, MINI_NODES);
  const index = new Map(kept.map((n, i) => [n.id, i]));

  const rnd = mulberry32(graph.nodes.length * 2654435761 + kept.length);
  const nodes: MiniNode[] = kept.map((n) => ({
    id: n.id,
    x: 8 + rnd() * Math.max(1, w - 16),
    y: 8 + rnd() * Math.max(1, h - 16),
    r: radius.get(n.id) ?? 1,
  }));

  const edges: [number, number][] = [];
  for (const e of graph.edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a !== undefined && b !== undefined && a !== b) edges.push([a, b]);
  }

  const target = Math.max(14, Math.min(w, h) / 4);
  for (let pass = 0; pass < SETTLE_TICKS; pass++) {
    for (const [a, b] of edges) {
      const A = nodes[a];
      const B = nodes[b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - target) * 0.012;
      A.x += (dx / d) * f;
      A.y += (dy / d) * f;
      B.x -= (dx / d) * f;
      B.y -= (dy / d) * f;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const A = nodes[i];
        const B = nodes[j];
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = A.r + B.r + 6;
        if (d < min) {
          const f = (min - d) * 0.05;
          A.x -= (dx / d) * f;
          A.y -= (dy / d) * f;
          B.x += (dx / d) * f;
          B.y += (dy / d) * f;
        }
      }
      const n = nodes[i];
      n.x = Math.max(n.r + 1, Math.min(w - n.r - 1, n.x));
      n.y = Math.max(n.r + 1, Math.min(h - n.r - 1, n.y));
    }
  }

  return { nodes, edges };
}

// Keyed by graph identity so reopening the home screen never re-settles. A
// WeakMap means a workspace's layout is collected with its graph — no manual
// invalidation, and a rescan produces a new graph object and so a new layout.
const cache = new WeakMap<VaultGraph, Map<string, MiniLayout>>();

export function layoutFor(graph: VaultGraph, w: number, h: number): MiniLayout {
  let bySize = cache.get(graph);
  if (!bySize) {
    bySize = new Map();
    cache.set(graph, bySize);
  }
  const key = `${w}x${h}`;
  let layout = bySize.get(key);
  if (!layout) {
    layout = settleLayout(graph, w, h);
    bySize.set(key, layout);
  }
  return layout;
}
