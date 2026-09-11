import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractImpact } from "../../src/main/impact-paths";

const fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, "..", "fixtures", "hook", "posttooluse-impact.json"),
    "utf8",
  ),
) as { tool_response: unknown };

describe("extractImpact", () => {
  it("reads the target as depth 0 and each byDepth entry at its own depth", () => {
    const hits = extractImpact(fixture.tool_response);
    expect(hits).toContainEqual({
      path: "src/renderer/session/highlight-store.ts",
      depth: 0,
    });
    expect(hits).toContainEqual({
      path: "src/renderer/session/replay.ts",
      depth: 1,
    });
  });

  it("keeps the smallest depth for a file reachable twice", () => {
    const hits = extractImpact(fixture.tool_response);
    const app = hits.filter((h) => h.path === "src/renderer/App.tsx");
    expect(app).toHaveLength(1);
    expect(app[0].depth).toBe(1);
  });

  it("returns hits in ascending depth order", () => {
    const depths = extractImpact(fixture.tool_response).map((h) => h.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });

  it("parses a bare object as well as the MCP text wrapper", () => {
    const bare = {
      target: { filePath: "a.ts" },
      byDepth: { "1": [{ filePath: "b.ts" }] },
    };
    expect(extractImpact(bare)).toEqual([
      { path: "a.ts", depth: 0 },
      { path: "b.ts", depth: 1 },
    ]);
  });

  it("caps at MATCH_CAP, dropping the deepest first", () => {
    const byDepth: Record<string, Array<{ filePath: string }>> = {
      "1": Array.from({ length: 30 }, (_, i) => ({ filePath: `near${i}.ts` })),
      "2": Array.from({ length: 30 }, (_, i) => ({ filePath: `far${i}.ts` })),
    };
    const hits = extractImpact({ byDepth });
    expect(hits).toHaveLength(40);
    expect(hits.filter((h) => h.depth === 1)).toHaveLength(30);
    expect(hits.filter((h) => h.depth === 2)).toHaveLength(10);
  });

  it("returns an empty array for junk, and never throws", () => {
    expect(extractImpact(null)).toEqual([]);
    expect(extractImpact("not json")).toEqual([]);
    expect(
      extractImpact({ content: [{ type: "text", text: "{oops" }] }),
    ).toEqual([]);
    expect(extractImpact(42)).toEqual([]);
  });
});
