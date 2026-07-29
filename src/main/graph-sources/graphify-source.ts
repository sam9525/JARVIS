import { promises as fs } from "node:fs";
import path from "node:path";
import { topFolder } from "../gitnexus-graph";
import { gitHead } from "./gitnexus-source";
import type { VaultGraph, GraphEdge } from "../../shared/types";
import type { GraphSource } from "./types";

// Informal contract with the graphify pipeline: graphify-out/graph.json is
// networkx node_link_data. Only the fields read here are modelled; relation,
// confidence, weight, and hyperedges are deliberately dropped (GraphEdge has
// no room and nothing renders them), and so are label/norm_label — GraphNode
// has no display name, every view labels a node by its id. Pinned by
// tests/fixtures/graphify/ — a format change fails there first.
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

const OUT_DIR = "graphify-out";

function readGraph(rootPath: string): Promise<GraphifyGraph> {
  return fs
    .readFile(path.join(rootPath, OUT_DIR, "graph.json"), "utf8")
    .then((raw) => JSON.parse(raw) as GraphifyGraph);
}

// written by the pipeline's labelling step and optional by design — absent,
// unreadable, or malformed all mean "no labels"
function readLabels(rootPath: string): Promise<Record<string, string>> {
  return fs
    .readFile(path.join(rootPath, OUT_DIR, ".graphify_labels.json"), "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, string>)
        : {};
    })
    .catch(() => ({}));
}

export function isStale(
  commit: string | null | undefined,
  head: string | null,
): boolean {
  return typeof commit === "string" && !!head && commit !== head;
}

const EMPTY = { nodes: [], edges: [] };

export const graphifySource: GraphSource = {
  id: "graphify",
  detect: (ws) =>
    fs.stat(path.join(ws.rootPath, OUT_DIR, "graph.json")).then(
      () => true,
      () => false,
    ),
  load: (ws) =>
    readGraph(ws.rootPath)
      .then(buildFileGraph)
      .catch((err) => {
        console.error(`graphify graph failed for ${ws.name}:`, err);
        return EMPTY;
      }),
  loadSymbols: (ws) =>
    Promise.all([readGraph(ws.rootPath), readLabels(ws.rootPath)])
      .then(([g, labels]) => buildSymbolGraph(g, labels))
      .catch((err) => {
        console.error(`graphify symbol graph failed for ${ws.name}:`, err);
        return EMPTY;
      }),
  // index() deliberately absent: the pipeline is agent-driven (LLM subagents),
  // so there is no headless invocation — and detect() only passes when a graph
  // already exists. Rebuilds are `/graphify .` in the workspace's own terminal.
  reindexCommand: "/graphify .",
  // ponytail: stale() parses the whole ~2 MB graph.json to read one trailing
  // field; stale-reindex-command fires on workspace switch, not per frame — cache
  // built_at_commit beside the loaded graph if this ever shows in a profile
  stale: async (rootPath) =>
    isStale(
      await readGraph(rootPath).then(
        (g) => g.built_at_commit,
        () => null,
      ),
      await gitHead(rootPath),
    ),
};
