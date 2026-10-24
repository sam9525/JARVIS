import type { GraphGroup, VaultGraph, ViewSettings } from "../../shared/types";
import {
  matchProgress,
  pulseProgress,
  type HighlightState,
} from "../session/highlight-store";
import type { GraphFilters } from "./graph-filter";

export type SnapshotInputs = { graph: VaultGraph; rev: number; look: string };
export type CardSnapshot = { url: string; inputs: SnapshotInputs };

// Renderer memory only, keyed by workspace id.
export const snapshots = new Map<string, CardSnapshot>();

export function canSnapshot(graph: VaultGraph | null): graph is VaultGraph {
  return graph !== null && !graph.failed && graph.nodes.length > 0;
}

// Serialised so a re-render that hands over equal-but-fresh objects yields the same key.
export function lookKey(parts: {
  baseHue: number;
  groups: GraphGroup[];
  view: ViewSettings;
  filters: Omit<GraphFilters, "search">;
  width: number;
  height: number;
  dpr: number; // the canvas backing store scales with it
}): string {
  return JSON.stringify(parts);
}

// The graph is compared by identity: a reload yields a new object and a new layout.
export function snapshotValid(
  s: CardSnapshot | undefined,
  now: SnapshotInputs,
): boolean {
  return (
    s !== undefined &&
    s.inputs.graph === now.graph &&
    s.inputs.rev === now.rev &&
    s.inputs.look === now.look
  );
}

export function isStill(state: HighlightState, now: number): boolean {
  return (
    pulseProgress(state, now) === null && matchProgress(state, now) === null
  );
}
