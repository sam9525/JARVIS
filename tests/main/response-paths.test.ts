import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractPaths, MAX_PATHS } from "../../src/main/response-paths";

// Shapes observed in the captured fixtures (Task 1) — see
// tests/fixtures/hook/ for the verbatim payloads.
const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      path.join(__dirname, "..", "fixtures", "hook", `${name}.json`),
      "utf8",
    ),
  );

const responseOf = (name: string): unknown =>
  (fixture(name) as { tool_response?: unknown }).tool_response;

describe("extractPaths", () => {
  it("pulls file paths out of the Grep files_with_matches payload", () => {
    const paths = extractPaths(responseOf("grep-files-with-matches"));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => /\.[a-z]+$/i.test(p))).toBe(true);
  });

  it("pulls file paths out of the Glob payload", () => {
    const paths = extractPaths(responseOf("glob"));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => /\.[a-z]+$/i.test(p))).toBe(true);
  });

  it("strips the :line:content suffix from Grep content mode", () => {
    const paths = extractPaths(responseOf("grep-content"));
    expect(paths.length).toBeGreaterThan(0);
    // no extracted path may still carry a match body
    expect(paths.some((p) => p.includes("export function"))).toBe(false);
  });

  it("reads a bare newline-separated string", () => {
    expect(extractPaths("D:\\vault\\a.md\nD:\\vault\\b.md")).toEqual([
      "D:\\vault\\a.md",
      "D:\\vault\\b.md",
    ]);
  });

  it("strips a line:column:text suffix from a content-mode line", () => {
    expect(extractPaths("D:\\vault\\a.md:12:const x = 1")).toEqual([
      "D:\\vault\\a.md",
    ]);
  });

  it("recurses into arrays and object values", () => {
    expect(extractPaths({ filenames: ["a/b.ts", "c/d.ts"] })).toEqual([
      "a/b.ts",
      "c/d.ts",
    ]);
    expect(extractPaths([["a/b.ts"], { any: "c/d.ts" }])).toEqual([
      "a/b.ts",
      "c/d.ts",
    ]);
  });

  it("ignores prose, counts, and anything without a separator or extension", () => {
    expect(extractPaths("Found 3 files")).toEqual([]);
    expect(extractPaths({ numFiles: 3, mode: "files_with_matches" })).toEqual(
      [],
    );
  });

  it("returns [] for garbage rather than throwing", () => {
    expect(extractPaths(undefined)).toEqual([]);
    expect(extractPaths(null)).toEqual([]);
    expect(extractPaths(42)).toEqual([]);
    expect(extractPaths(true)).toEqual([]);
  });

  it("stops at the depth cap instead of walking forever", () => {
    // self-referencing object — must terminate
    const cyclic: Record<string, unknown> = { a: "x/y.ts" };
    cyclic.self = cyclic;
    expect(() => extractPaths(cyclic)).not.toThrow();
    expect(extractPaths(cyclic)).toContain("x/y.ts");
  });

  it("stops collecting once the cap is reached", () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `src/file${i}.ts`).join(
      "\n",
    );
    expect(extractPaths(huge).length).toBe(MAX_PATHS);
  });
});
