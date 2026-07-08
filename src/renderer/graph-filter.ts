import type { SectionFilter, VaultGraph } from "../shared/types";

// "both" is a pass-through so the memoized graph identity is stable
export function filterGraph(g: VaultGraph, filter: SectionFilter): VaultGraph {
  if (filter === "both") return g;

  const visibleNotes = new Set(
    g.nodes
      .filter((n) => n.type === "note" && n.section === filter)
      .map((n) => n.id),
  );
  const tagIds = new Set(
    g.nodes.filter((n) => n.type === "tag").map((n) => n.id),
  );

  const edges = g.edges.filter(
    (e) =>
      visibleNotes.has(e.source) &&
      (visibleNotes.has(e.target) || tagIds.has(e.target)),
  );
  const visibleTags = new Set(
    edges.map((e) => e.target).filter((t) => tagIds.has(t)),
  );
  const nodes = g.nodes.filter(
    (n) => visibleNotes.has(n.id) || visibleTags.has(n.id),
  );
  return { nodes, edges };
}
