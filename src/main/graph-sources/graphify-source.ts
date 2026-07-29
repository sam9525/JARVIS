import { topFolder } from "../gitnexus-graph";
import type { VaultGraph, GraphEdge } from "../../shared/types";

// Informal contract with the graphify pipeline: graphify-out/graph.json is
// networkx node_link_data. Only the fields read here are modelled; relation,
// confidence, weight, and hyperedges are deliberately dropped (GraphEdge has
// no room and nothing renders them). Pinned by tests/fixtures/graphify/ — a
// format change fails there first.
export interface GraphifyNode {
  id: string;
  source_file?: string; // repo-relative POSIX; "" or absent = no file
  community?: number; // Louvain cluster id
}

export interface GraphifyLink {
  source: string;
  target: string;
}

export interface GraphifyGraph {
  nodes?: GraphifyNode[];
  links?: GraphifyLink[];
  built_at_commit?: string;
}

// File level: group nodes by source_file. The map goes node id → file first —
// a link's own source_file is where the edge was *extracted*, not where its
// endpoints live, so endpoints must resolve through their nodes.
export function buildFileGraph(g: GraphifyGraph): VaultGraph {
  const fileOf = new Map<string, string>();
  for (const n of g.nodes ?? []) {
    if (n.source_file) fileOf.set(n.id, n.source_file);
  }
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const l of g.links ?? []) {
    const a = fileOf.get(l.source);
    const b = fileOf.get(l.target);
    if (!a || !b || a === b) continue; // intra-file structure or fileless endpoint
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`; // graph is undirected
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: a, target: b });
  }
  return {
    nodes: [...new Set(fileOf.values())].map((p) => ({
      id: p,
      type: "note" as const,
      domain: topFolder(p),
    })),
    edges,
  };
}

// Symbol level: graphify nodes 1:1, domains from community labels — here the
// mapping is exact (one node, one community), unlike file level where a file
// can span several.
export function buildSymbolGraph(
  g: GraphifyGraph,
  labels: Record<string, string>,
): VaultGraph {
  const nodes = g.nodes ?? [];
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: "note" as const,
      domain: labels[String(n.community)] ?? String(n.community),
      file: n.source_file || undefined,
    })),
    edges: (g.links ?? [])
      .filter(
        (l) => l.source !== l.target && ids.has(l.source) && ids.has(l.target),
      )
      .map((l) => ({ source: l.source, target: l.target })),
  };
}
