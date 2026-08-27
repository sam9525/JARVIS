import type {
  GraphEdge,
  GraphNode,
  VaultGraph,
  Workspace,
} from "../../shared/types";
import { busiest } from "./graph-filter";
import { graphMetrics } from "./graph-metrics";

export const FLEET_ROOT = "root::jarvis";
export const FLEET_ROOT_DOMAIN = "JARVIS";

/** One group per workspace that has a stored main colour, so each cluster wears
 * the first hue that project's own groups drew. Every fleet id holds its
 * workspace id — `<wsId>::note` for a member, `hub::<wsId>` for the hub — so
 * the bare id matches both. Longest query first: one workspace id can be a
 * prefix of another, and `groupOf` takes the first match it finds.
 *
 * Colour goes through groups rather than the domain spread because these are
 * arbitrary stored colours, not an nth-of-n position. Both views read `groups`
 * for colour only and take halos from a separate prop, so this adds no halo. */
export function clusterGroups(
  workspaces: Workspace[],
  mainColors: Record<string, string> = {},
): { query: string; color: string }[] {
  return workspaces
    .filter((ws) => mainColors[ws.id])
    .map((ws) => ({ query: ws.id, color: mainColors[ws.id] }))
    .sort((a, b) => b.query.length - a.query.length);
}

/** The domain list every fleet colour is drawn from: one entry per workspace
 * name, plus the root. Derived from the workspace list rather than from the
 * built graph, because a workspace whose graph has not loaded yet contributes
 * no nodes — and `domainsOf(fleet)` then shifted every later workspace onto a
 * different hue. Also what `workspaceHue` indexes into, so a project draws the
 * same colour in its own graph as it does here. */
export function fleetDomains(workspaces: Workspace[]): string[] {
  return Array.from(
    new Set([...workspaces.map((w) => w.name), FLEET_ROOT_DOMAIN]),
  ).sort();
}
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

// a vault note "about" the project: exact basename, else a basename that
// contains the (>=3 char) project name as a whole word (so "app" matches
// "app-router" but not "mapping"). First match wins; Map iteration is
// insertion order.
function matchVaultNote(
  projectName: string,
  vaultNoteByName: Map<string, string>,
): string | undefined {
  const p = projectName.toLowerCase();
  const exact = vaultNoteByName.get(p);
  if (exact) return exact;
  if (p.length < 3) return undefined;
  for (const [name, id] of vaultNoteByName)
    if (name.split(/[^a-z0-9]+/).includes(p)) return id;
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
    { id: FLEET_ROOT, type: "note", domain: FLEET_ROOT_DOMAIN },
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
      // first note with a given basename wins the match slot
      if (ws.kind === "vault") {
        const key = basename(n.id);
        if (!vaultNoteByName.has(key)) vaultNoteByName.set(key, px(n.id));
      }
    }
    for (const e of capped.edges)
      edges.push({ source: px(e.source), target: px(e.target) });
    return capped;
  };

  // 1) vault at the centre: its cluster, anchored to the root.
  // ponytail: single-vault assumption — any extra vault workspaces are skipped
  // in step 2. Treat them as project clusters if multi-vault ever ships.
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
