import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanVault,
  toNodeId,
  resolveWikilink,
  resolveMdLink,
} from "../src/main/vault-graph";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "vault",
);

describe("toNodeId", () => {
  it("normalizes abs path to vault-relative POSIX id without .md", () => {
    expect(toNodeId("D:\\vault", "D:\\vault\\notes\\beta.md")).toBe(
      "notes/beta",
    );
  });
});

describe("resolveWikilink", () => {
  it("resolves case-insensitive nested wikilink matching using byPathLower", () => {
    const byPath = new Set(["notes/beta"]);
    const byPathLower = new Map([["notes/beta", "notes/beta"]]);
    const byBasename = new Map([["beta", "notes/beta"]]);

    // Exact case match
    expect(resolveWikilink("notes/beta", byPath, byBasename, byPathLower)).toBe(
      "notes/beta",
    );

    // Case-insensitive nested match
    expect(resolveWikilink("notes/Beta", byPath, byBasename, byPathLower)).toBe(
      "notes/beta",
    );
    expect(resolveWikilink("Notes/beta", byPath, byBasename, byPathLower)).toBe(
      "notes/beta",
    );
    expect(resolveWikilink("NOTES/BETA", byPath, byBasename, byPathLower)).toBe(
      "notes/beta",
    );
  });
});

describe("resolveMdLink", () => {
  it("handles malformed markdown links without crashing, falling back to raw href", () => {
    const byPath = new Set(["50%completed"]);
    const byPathLower = new Map([["50%completed", "50%completed"]]);

    // 50%completed.md has a malformed percent encoding, causing decodeURI to throw.
    // It should fall back to the raw href and still resolve correctly.
    expect(resolveMdLink("50%completed.md", "index", byPath, byPathLower)).toBe(
      "50%completed",
    );
  });

  it("resolves case-insensitive markdown links using byPathLower", () => {
    const byPath = new Set(["notes/beta"]);
    const byPathLower = new Map([["notes/beta", "notes/beta"]]);

    // Source-relative case-insensitive check
    expect(resolveMdLink("Beta.md", "notes/alpha", byPath, byPathLower)).toBe(
      "notes/beta",
    );
    expect(resolveMdLink("BETA.md", "notes/alpha", byPath, byPathLower)).toBe(
      "notes/beta",
    );

    // Vault-root-relative case-insensitive check
    expect(
      resolveMdLink("notes/Beta.md", "sub/folder", byPath, byPathLower),
    ).toBe("notes/beta");
    expect(
      resolveMdLink("NOTES/BETA.md", "sub/folder", byPath, byPathLower),
    ).toBe("notes/beta");
  });
});

describe("scanVault", () => {
  it("builds nodes and edges from wikilinks, md links, and tags", async () => {
    const g = await scanVault(FIXTURE);

    const ids = g.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["Alpha", "index", "notes/beta", "tag:project"]);

    expect(g.nodes.find((n) => n.id === "tag:project")?.type).toBe("tag");
    expect(g.nodes.find((n) => n.id === "Alpha")?.type).toBe("note");

    const edges = g.edges.map((e) => `${e.source}>${e.target}`).sort();
    expect(edges).toEqual(
      [
        "Alpha>tag:project",
        "index>Alpha",
        "index>notes/beta",
        "index>tag:project",
        "notes/beta>Alpha",
      ].sort(),
    );
  });
});
