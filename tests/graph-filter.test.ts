import { describe, it, expect } from "vitest";
import { filterGraph } from "../src/renderer/graph-filter";
import type { GraphFilters } from "../src/renderer/graph-filter";
import type { VaultGraph } from "../src/shared/types";

const g: VaultGraph = {
  nodes: [
    { id: "physics/raw/a", type: "note", domain: "physics", section: "raw" },
    { id: "physics/wiki/b", type: "note", domain: "physics", section: "wiki" },
    { id: "history/raw/c", type: "note", domain: "history", section: "raw" },
    { id: "physics/lonely", type: "note", domain: "physics", section: "raw" },
    { id: "tag:shared", type: "tag" },
    { id: "tag:wikionly", type: "tag" },
  ],
  edges: [
    { source: "physics/raw/a", target: "physics/wiki/b" },
    { source: "physics/raw/a", target: "tag:shared" },
    { source: "physics/wiki/b", target: "tag:wikionly" },
    { source: "history/raw/c", target: "physics/raw/a" },
  ],
};

const all: GraphFilters = {
  sectionFilter: "both",
  search: "",
  showTags: true,
  showOrphans: true,
};

describe("filterGraph", () => {
  it("returns the same object when every filter is at its default", () => {
    expect(filterGraph(g, all)).toBe(g);
  });

  it("raw: keeps raw notes, edges between them, and tags they reference", () => {
    const f = filterGraph(g, { ...all, sectionFilter: "raw" });
    expect(f.nodes.map((n) => n.id).sort()).toEqual([
      "history/raw/c",
      "physics/lonely",
      "physics/raw/a",
      "tag:shared",
    ]);
    expect(f.edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual([
      "history/raw/c>physics/raw/a",
      "physics/raw/a>tag:shared",
    ]);
  });

  it("search: case-insensitive substring on note id, keeps surviving tags", () => {
    const f = filterGraph(g, { ...all, search: "WIKI" });
    expect(f.nodes.map((n) => n.id).sort()).toEqual([
      "physics/wiki/b",
      "tag:wikionly",
    ]);
    expect(f.edges).toEqual([
      { source: "physics/wiki/b", target: "tag:wikionly" },
    ]);
  });

  it("tags off: drops tag nodes and their edges", () => {
    const f = filterGraph(g, { ...all, showTags: false });
    expect(f.nodes.every((n) => n.type === "note")).toBe(true);
    expect(f.edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual([
      "history/raw/c>physics/raw/a",
      "physics/raw/a>physics/wiki/b",
    ]);
  });

  it("orphans off: drops nodes left with no edges by earlier filters", () => {
    const f = filterGraph(g, {
      ...all,
      sectionFilter: "raw",
      showOrphans: false,
    });
    expect(f.nodes.map((n) => n.id).sort()).toEqual([
      "history/raw/c",
      "physics/raw/a",
      "tag:shared",
    ]);
  });
});
