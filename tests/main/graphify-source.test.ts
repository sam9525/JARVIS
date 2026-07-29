import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFileGraph,
  buildSymbolGraph,
  type GraphifyGraph,
} from "../../src/main/graph-sources/graphify-source";

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "graphify");

const fixture = (): GraphifyGraph =>
  JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, "graph.json"), "utf8"),
  ) as GraphifyGraph;

describe("buildFileGraph", () => {
  it("emits one node per distinct source_file with a topFolder domain", () => {
    const g = buildFileGraph(fixture());
    expect(new Map(g.nodes.map((n) => [n.id, n.domain]))).toEqual(
      new Map([
        ["src/a.ts", "src"],
        ["src/b.ts", "src"],
        ["docs/readme.md", "docs"],
      ]),
    );
    expect(g.nodes.every((n) => n.type === "note")).toBe(true);
  });

  it("keeps cross-file links, deduped across direction", () => {
    // a_fn→b_fn and b_fn→a_fn are the same file pair; one edge survives
    const g = buildFileGraph(fixture());
    const pairs = g.edges.map((e) => [e.source, e.target].sort().join("|"));
    expect(pairs.sort()).toEqual([
      "docs/readme.md|src/a.ts",
      "src/a.ts|src/b.ts",
    ]);
  });

  it("collapses same-file links to nothing", () => {
    // both `contains` links and the self-loop live inside one file
    const g = buildFileGraph(fixture());
    expect(g.edges).toHaveLength(2);
  });

  it("skips nodes without a source_file — empty string and absent alike", () => {
    // ghost_session ("" — an unresolved AST ref) and url_note (source_url
    // only) must produce no file node and no edge endpoint
    const g = buildFileGraph(fixture());
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.has("")).toBe(false);
    expect(g.nodes).toHaveLength(3);
  });
});

describe("buildSymbolGraph", () => {
  const labels = { "0": "Data Loading" };

  it("maps graphify nodes 1:1 with id, file, and community-label domain", () => {
    const g = buildSymbolGraph(fixture(), labels);
    expect(g.nodes).toHaveLength(7);
    const aFn = g.nodes.find((n) => n.id === "a_fn");
    expect(aFn).toMatchObject({
      type: "note",
      domain: "Data Loading",
      file: "src/a.ts",
    });
  });

  it("falls back to the numeric community when no label exists", () => {
    const g = buildSymbolGraph(fixture(), labels);
    expect(g.nodes.find((n) => n.id === "b_fn")?.domain).toBe("1");
  });

  it("carries no file for nodes that have none", () => {
    const g = buildSymbolGraph(fixture(), labels);
    expect(g.nodes.find((n) => n.id === "ghost_session")?.file).toBeUndefined();
    expect(g.nodes.find((n) => n.id === "url_note")?.file).toBeUndefined();
  });

  it("keeps links 1:1 minus self-loops", () => {
    // 7 fixture links, one is a self-loop; parallel A→B / B→A both survive,
    // same as gitnexus buildSymbolGraph
    const g = buildSymbolGraph(fixture(), labels);
    expect(g.edges).toHaveLength(6);
    expect(g.edges.some((e) => e.source === e.target)).toBe(false);
  });

  it("labels apply per node even when a file spans communities", () => {
    // no labels at all → every domain is the stringified community id
    const g = buildSymbolGraph(fixture(), {});
    expect(g.nodes.find((n) => n.id === "a_fn")?.domain).toBe("0");
  });
});
