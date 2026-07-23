import { readFileSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCodeGraph,
  buildSymbolGraph,
  hasIndex,
  insideGitRepo,
  loadCodeGraph,
  loadSymbolGraph,
  parseCypherTable,
} from "../src/main/gitnexus-graph";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", "gitnexus", name), "utf8");

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "jarvis-graph-"));

describe("hasIndex", () => {
  it("is true when the project holds a .gitnexus directory", async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, ".gitnexus"));
    expect(await hasIndex(dir)).toBe(true);
  });

  it("is false for a project that was never analyzed", async () => {
    // the whole point: without this, loadCodeGraph asks the CLI to resolve a
    // name that is not in the registry, and it throws "Repository not found"
    expect(await hasIndex(await tmp())).toBe(false);
  });

  it("is false when .gitnexus is a file rather than a directory", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, ".gitnexus"), "junk", "utf8");
    expect(await hasIndex(dir)).toBe(false);
  });
});

describe("insideGitRepo", () => {
  it("is true for a repo root", async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, ".git"));
    expect(await insideGitRepo(dir)).toBe(true);
  });

  it("is true when .git is a file, as in a worktree or submodule", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, ".git"), "gitdir: ../real/.git", "utf8");
    expect(await insideGitRepo(dir)).toBe(true);
  });

  it("is true for a subdirectory of a repo", async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, ".git"));
    const sub = path.join(dir, "packages", "app");
    await fs.mkdir(sub, { recursive: true });
    expect(await insideGitRepo(sub)).toBe(true);
  });

  it("is false when no ancestor holds a .git", async () => {
    // gitnexus analyze exits 1 here with "Not inside a git repository",
    // which is what --skip-git exists for
    expect(await insideGitRepo(await tmp())).toBe(false);
  });
});

describe("parseCypherTable", () => {
  it("parses the captured files fixture into single-column rows", () => {
    const rows = parseCypherTable(fixture("files.json"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveLength(1);
    expect(rows.some(([p]) => p === "src/main/event-mapper.ts")).toBe(true);
  });

  it("parses the captured imports fixture into pairs", () => {
    const rows = parseCypherTable(fixture("imports.json"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveLength(2);
  });

  it("returns [] for an empty result and throws on gitnexus errors", () => {
    expect(
      parseCypherTable(
        JSON.stringify({ markdown: "| f.filePath |\n| --- |", row_count: 0 }),
      ),
    ).toEqual([]);
    expect(() => parseCypherTable(JSON.stringify({ error: "boom" }))).toThrow(
      "boom",
    );
    expect(() => parseCypherTable("not json")).toThrow();
  });
});

describe("buildCodeGraph", () => {
  it("makes note nodes with top-folder domains and import edges", () => {
    const g = buildCodeGraph(
      ["src/a.ts", "src/b.ts", "root.ts"],
      [
        ["src/a.ts", "src/b.ts"],
        ["src/a.ts", "gone.ts"], // endpoint not in files → dropped
      ],
    );
    expect(g.nodes).toEqual([
      { id: "src/a.ts", type: "note", domain: "src" },
      { id: "src/b.ts", type: "note", domain: "src" },
      { id: "root.ts", type: "note", domain: "." },
    ]);
    expect(g.edges).toEqual([{ source: "src/a.ts", target: "src/b.ts" }]);
  });
});

describe("loadCodeGraph", () => {
  it("rejects a repo name that could break out of the quoted shell argument", async () => {
    // registry.json is user-editable; this must fail before exec is reached
    await expect(loadCodeGraph('a" & echo pwned "')).rejects.toThrow(
      "unsafe repo name",
    );
    await expect(loadCodeGraph("has space")).rejects.toThrow(
      "unsafe repo name",
    );
    await expect(loadCodeGraph("")).rejects.toThrow("unsafe repo name");
  });
});

describe("buildSymbolGraph", () => {
  it("makes symbol nodes carrying their file, drops self-loops and dangling edges", () => {
    const g = buildSymbolGraph(
      [
        { id: "Function:src/a.ts:foo", name: "foo", file: "src/a.ts" },
        { id: "Function:src/a.ts:bar", name: "bar", file: "src/a.ts" },
        { id: "Method:root.ts:baz", name: "baz", file: "root.ts" },
      ],
      [
        ["Function:src/a.ts:foo", "Function:src/a.ts:bar"], // kept
        ["Function:src/a.ts:foo", "Function:src/a.ts:foo"], // self-loop → dropped
        ["Function:src/a.ts:bar", "Function:gone.ts:x"], // endpoint absent → dropped
      ],
    );
    expect(g.nodes).toEqual([
      { id: "Function:src/a.ts:foo", type: "note", domain: "src", file: "src/a.ts" },
      { id: "Function:src/a.ts:bar", type: "note", domain: "src", file: "src/a.ts" },
      { id: "Method:root.ts:baz", type: "note", domain: ".", file: "root.ts" },
    ]);
    expect(g.edges).toEqual([
      { source: "Function:src/a.ts:foo", target: "Function:src/a.ts:bar" },
    ]);
  });
});

describe("symbol fixtures", () => {
  it("parse into rows the builder accepts, and a known symbol survives", () => {
    const rows = parseCypherTable(fixture("symbols.json"));
    expect(rows[0]).toHaveLength(3);
    expect(rows.some(([id]) => id === "Function:src/main/event-mapper.ts:toNode")).toBe(true);

    const calls = parseCypherTable(fixture("calls.json"));
    expect(calls[0]).toHaveLength(2);
  });
});

describe("loadSymbolGraph", () => {
  it("rejects an unsafe repo name before reaching exec", async () => {
    await expect(loadSymbolGraph('a" & echo pwned "')).rejects.toThrow(
      "unsafe repo name",
    );
  });
});

