import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFileGraph,
  buildSymbolGraph,
  graphifySource,
  isStale,
  type GraphifyGraph,
} from "../../src/main/graph-sources/graphify-source";
import type { Workspace } from "../../src/shared/types";

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

  // the fixture carries a real 3-member hyperedge; the contract is that it
  // contributes no edges, not that the pipeline stopped emitting them
  it("drops hyperedges rather than expanding them into pairs", () => {
    const g = buildFileGraph(fixture());
    expect(g.edges).toHaveLength(2); // unchanged by h1's a_fn/b_fn/readme_doc
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

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "jarvis-graphify-"));

const wsAt = (rootPath: string): Workspace => ({
  id: "w",
  name: "w",
  rootPath,
  kind: "code",
  sourceId: "graphify",
});

// copy the pinned fixture into a temp workspace's graphify-out/
const plantFixture = async (root: string, withLabels: boolean) => {
  const out = path.join(root, "graphify-out");
  await fs.mkdir(out, { recursive: true });
  await fs.copyFile(
    path.join(FIXTURE_DIR, "graph.json"),
    path.join(out, "graph.json"),
  );
  if (withLabels)
    await fs.copyFile(
      path.join(FIXTURE_DIR, ".graphify_labels.json"),
      path.join(out, ".graphify_labels.json"),
    );
};

describe("graphifySource", () => {
  it("detects only when graphify-out/graph.json exists", async () => {
    const root = await tmp();
    expect(await graphifySource.detect(wsAt(root))).toBe(false);
    await plantFixture(root, false);
    expect(await graphifySource.detect(wsAt(root))).toBe(true);
  });

  it("has no index() — rebuilds are /graphify in the workspace terminal", () => {
    expect(graphifySource.index).toBeUndefined();
  });

  it("loads the file-level graph from disk", async () => {
    const root = await tmp();
    await plantFixture(root, false);
    const g = await graphifySource.load(wsAt(root));
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      "docs/readme.md",
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(g.edges).toHaveLength(2);
  });

  it("loads the symbol-level graph with community labels applied", async () => {
    const root = await tmp();
    await plantFixture(root, true);
    const g = await graphifySource.loadSymbols!(wsAt(root));
    expect(g.nodes.find((n) => n.id === "a_fn")?.domain).toBe("Data Loading");
  });

  it("treats missing labels as optional — numeric domains, no throw", async () => {
    const root = await tmp();
    await plantFixture(root, false);
    const g = await graphifySource.loadSymbols!(wsAt(root));
    expect(g.nodes.find((n) => n.id === "a_fn")?.domain).toBe("0");
  });

  it("degrades missing or corrupt graph.json to an empty graph", async () => {
    const missing = await tmp();
    expect(await graphifySource.load(wsAt(missing))).toEqual({
      nodes: [],
      edges: [],
    });
    const corrupt = await tmp();
    const out = path.join(corrupt, "graphify-out");
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, "graph.json"), "{not json", "utf8");
    expect(await graphifySource.load(wsAt(corrupt))).toEqual({
      nodes: [],
      edges: [],
    });
    expect(await graphifySource.loadSymbols!(wsAt(corrupt))).toEqual({
      nodes: [],
      edges: [],
    });
  });
});

describe("graphify stale", () => {
  it("is stale only when both sides are known and differ", () => {
    expect(isStale("abc", "def")).toBe(true);
    expect(isStale("abc", "abc")).toBe(false);
    expect(isStale(undefined, "abc")).toBe(false); // no commit recorded
    expect(isStale("abc", null)).toBe(false); // git failed → don't cry wolf
  });

  it("stale() reports false outside a git repo", async () => {
    const root = await tmp();
    await plantFixture(root, false);
    // tmpdir is not a git repo → gitHead resolves null → never stale
    expect(await graphifySource.stale!(root)).toBe(false);
  });
});
