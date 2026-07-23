import type {
  GraphEdge,
  GraphNode,
  VaultGraph,
  Workspace,
} from "../shared/types";
import { busiest } from "./graph-filter";
import { graphMetrics } from "./graph-metrics";

export const FLEET_ROOT = "root::jarvis";
const PROJECT_CAP = 80;
const VAULT_CAP = 150;

// last path segment, lowercased: "Projects/AeroGraph" -> "aerograph"
function basename(id: string): string {
  const slash = id.lastIndexOf("/");
  return (slash === -1 ? id : id.slice(slash + 1)).toLowerCase();
}

// highest-degree node in a (small, un-prefixed) subgraph — the cluster's anchor
function busiestNodeId(g: VaultGraph): string | undefined {
  if (g.nodes.length === 0) return undefined;
  const { neighbors } = graphMetrics(g);
  let best = g.nodes[0].id;
  let bestDeg = -1;
  for (const n of g.nodes) {
    const d = neighbors.get(n.id)?.size ?? 0;
    if (d > bestDeg) {
      bestDeg = d;
      best = n.id;
    }
  }
  return best;
}

// a vault note "about" the project: exact basename, else basename contains the
// (>=3 char) project name. First match wins; Map iteration is insertion order.
function matchVaultNote(
  projectName: string,
  vaultNoteByName: Map<string, string>,
): string | undefined {
  const p = projectName.toLowerCase();
  const exact = vaultNoteByName.get(p);
  if (exact) return exact;
  if (p.length < 3) return undefined;
  for (const [name, id] of vaultNoteByName) if (name.includes(p)) return id;
  return undefined;
}

// Union of every loaded workspace graph into one force graph: ids prefixed per
// workspace, coloured by workspace name, each project a hub-anchored cluster
// spoked to the vault (real note reference) or the JARVIS root (fallback).
export function buildFleetGraph(
  workspaces: Workspace[],
  graphs: Map<string, VaultGraph>,
): VaultGraph {
  const nodes: GraphNode[] = [
    { id: FLEET_ROOT, type: "note", domain: "JARVIS" },
  ];
  const edges: GraphEdge[] = [];
  const vaultNoteByName = new Map<string, string>();

  // add a workspace's capped subgraph (prefixed + recoloured), return the cap
  const addWs = (ws: Workspace, cap: number): VaultGraph | undefined => {
    const g = graphs.get(ws.id);
    if (!g) return undefined;
    const capped = busiest(g, cap);
    const px = (id: string) => `${ws.id}::${id}`;
    for (const n of capped.nodes) {
      nodes.push({ ...n, id: px(n.id), domain: ws.name });
      if (ws.kind === "vault") vaultNoteByName.set(basename(n.id), px(n.id));
    }
    for (const e of capped.edges)
      edges.push({ source: px(e.source), target: px(e.target) });
    return capped;
  };

  // 1) vault at the centre: its cluster, anchored to the root
  const vault = workspaces.find((w) => w.kind === "vault");
  if (vault) {
    const capped = addWs(vault, VAULT_CAP);
    const anchor = capped && busiestNodeId(capped);
    if (anchor)
      edges.push({ source: FLEET_ROOT, target: `${vault.id}::${anchor}` });
  }

  // 2) each project: its cluster + a hub, spoked to a vault note or the root
  for (const ws of workspaces) {
    if (ws.kind === "vault") continue;
    const capped = addWs(ws, PROJECT_CAP);
    if (!capped) continue;
    const hub = `hub::${ws.id}`;
    nodes.push({ id: hub, type: "note", domain: ws.name });
    const anchor = busiestNodeId(capped);
    if (anchor) edges.push({ source: hub, target: `${ws.id}::${anchor}` });
    const match = matchVaultNote(ws.name, vaultNoteByName);
    edges.push({ source: match ?? FLEET_ROOT, target: hub });
  }

  return { nodes, edges };
}
