import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCodeGraph,
  loadCodeGraph,
  parseCypherTable,
} from "../src/main/gitnexus-graph";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", "gitnexus", name), "utf8");

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
