import type { SectionFilter, VaultGraph } from "../shared/types";

export interface GraphFilters {
  sectionFilter: SectionFilter;
  search: string; // "" = no search filter
  showTags: boolean;
  showOrphans: boolean;
}

// pipeline order: section → search → tags → orphans (orphans judged on the
// already-filtered graph, so a node orphaned BY a filter also hides).
// All-defaults input is a pass-through so the memoized graph identity is stable.
export function filterGraph(g: VaultGraph, f: GraphFilters): VaultGraph {
  const q = f.search.trim().toLowerCase();
  if (f.sectionFilter === "both" && q === "" && f.showTags && f.showOrphans) {
    return g;
  }

  const visibleNotes = new Set(
    g.nodes
      .filter(
        (n) =>
          n.type === "note" &&
          (f.sectionFilter === "both" || n.section === f.sectionFilter) &&
          (q === "" || n.id.toLowerCase().includes(q)),
      )
      .map((n) => n.id),
  );
  const tagIds = new Set(
    f.showTags ? g.nodes.filter((n) => n.type === "tag").map((n) => n.id) : [],
  );

  const edges = g.edges.filter(
    (e) =>
      visibleNotes.has(e.source) &&
      (visibleNotes.has(e.target) || tagIds.has(e.target)),
  );
  const visibleTags = new Set(
    edges.map((e) => e.target).filter((t) => tagIds.has(t)),
  );
  let nodes = g.nodes.filter(
    (n) => visibleNotes.has(n.id) || visibleTags.has(n.id),
  );

  if (!f.showOrphans) {
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    nodes = nodes.filter((n) => connected.has(n.id));
  }
  return { nodes, edges };
}
