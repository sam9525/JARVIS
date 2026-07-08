import { describe, it, expect } from "vitest";
import { filterGraph } from "../src/renderer/graph-filter";
import type { VaultGraph } from "../src/shared/types";

const g: VaultGraph = {
  nodes: [
    { id: "physics/raw/a", type: "note", domain: "physics", section: "raw" },
    { id: "physics/wiki/b", type: "note", domain: "physics", section: "wiki" },
    { id: "history/raw/c", type: "note", domain: "history", section: "raw" },
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

describe("filterGraph", () => {
  it("returns the same object for 'both'", () => {
    expect(filterGraph(g, "both")).toBe(g);
  });

  it("raw: keeps raw notes, edges between them, and tags they reference", () => {
    const f = filterGraph(g, "raw");
    expect(f.nodes.map((n) => n.id).sort()).toEqual([
      "history/raw/c",
      "physics/raw/a",
      "tag:shared",
    ]);
    // cross-section edge a→b dropped; wiki-only tag dropped
    expect(f.edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual([
      "history/raw/c>physics/raw/a",
      "physics/raw/a>tag:shared",
    ]);
  });

  it("wiki: keeps wiki notes and their tags only", () => {
    const f = filterGraph(g, "wiki");
    expect(f.nodes.map((n) => n.id).sort()).toEqual([
      "physics/wiki/b",
      "tag:wikionly",
    ]);
    expect(f.edges).toEqual([
      { source: "physics/wiki/b", target: "tag:wikionly" },
    ]);
  });
});
