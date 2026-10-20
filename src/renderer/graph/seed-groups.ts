import type { GraphGroup, VaultGraph } from "../../shared/types";
import { domainsOf } from "./domain-colors";
import { hueToHex, pickHues } from "./workspace-color";

// A folder of this many notes or fewer seeds no stored group. Its nodes still draw a
// colour — the domain spread off the workspace's main hue — but a halo and a
// settings entry for four notes is clutter, not information.
export const MIN_GROUP_NODES = 5;

export interface SeededGroups {
  groups: GraphGroup[];
  main: string;
  /** Every hue drawn, in draw order, for the caller to append to the pick log. */
  hues: number[];
}

/** A workspace's stored groups and main colour, drawn against the pick log.
 * Null for a graph with no folders yet, which the caller leaves unseeded. */
export function seedGroups(g: VaultGraph, log: number[]): SeededGroups | null {
  const folders = domainsOf(g);
  if (folders.length === 0) return null;
  const counts = new Map<string, number>();
  for (const n of g.nodes)
    if (n.domain) counts.set(n.domain, (counts.get(n.domain) ?? 0) + 1);
  const kept = folders.filter((d) => (counts.get(d) ?? 0) > MIN_GROUP_NODES);
  // Only kept folders draw: a hue for a folder that stores no group would still
  // take a slot in the log and push a visible colour out of it. A workspace
  // with no kept folder draws one hue for its main colour.
  const hues = pickHues(Math.max(kept.length, 1), log);
  // The biggest folder's colour is the project's identity, in Fleet and at
  // home — not the first hue drawn. Fleet paints a whole cluster with this,
  // and the colour a cluster reads as should be the one most of its nodes
  // already wear. Ties go to the first folder, which is alphabetical.
  const biggest = kept.reduce(
    (best, d, i) =>
      (counts.get(d) ?? 0) > (counts.get(kept[best]) ?? 0) ? i : best,
    0,
  );
  return {
    groups: kept.map((d, i) => ({ query: `${d}/`, color: hueToHex(hues[i]) })),
    main: hueToHex(hues[biggest]),
    hues,
  };
}
