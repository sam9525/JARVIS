import { SNAPSHOT_FORMAT } from "../../shared/types";
import type {
  CardLayout,
  GraphGroup,
  StoredSnapshot,
  VaultGraph,
  ViewSettings,
} from "../../shared/types";
import type { GraphFilters } from "./graph-filter";

export type CardSnapshot = { look: string; layout: CardLayout };

// Keyed by workspace id. Filled from main's stored files, then by live cards.
export const snapshots = new Map<string, CardSnapshot>();

export function canSnapshot(graph: VaultGraph | null): graph is VaultGraph {
  return graph !== null && !graph.failed && graph.nodes.length > 0;
}

// Serialised so a re-render that hands over equal-but-fresh objects yields the
// same key. The format is part of it, so a format bump invalidates every look.
export function lookKey(parts: {
  baseHue: number;
  groups: GraphGroup[];
  view: ViewSettings;
  filters: Omit<GraphFilters, "search">;
  width: number;
  height: number;
}): string {
  return JSON.stringify({ format: SNAPSHOT_FORMAT, ...parts });
}

// Main checks the graph by fingerprint before it hands a layout over, so only
// the look is left to compare here.
export function snapshotValid(
  s: CardSnapshot | undefined,
  look: string,
): boolean {
  return s?.look === look;
}

export function loadStoredSnapshots(list: StoredSnapshot[]): void {
  snapshots.clear();
  for (const s of list) snapshots.set(s.id, { look: s.look, layout: s.layout });
}

export function dropSnapshot(id: string): void {
  snapshots.delete(id);
}
