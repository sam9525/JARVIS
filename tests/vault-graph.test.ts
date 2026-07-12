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
  it("indexes only md under <domain>/raw|wiki, stamping domain and section", async () => {
    const g = await scanVault(FIXTURE);

    const ids = g.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([
      "arts/Raw/painting",
      "history/raw/timeline",
      "physics/raw/note1",
      "physics/wiki/overview",
      "tag:project",
    ]);

    const painting = g.nodes.find((n) => n.id === "arts/Raw/painting");
    expect(painting?.type).toBe("note");
    expect(painting?.domain).toBe("arts");
    expect(painting?.section).toBe("raw");

    const note1 = g.nodes.find((n) => n.id === "physics/raw/note1");
    expect(note1?.type).toBe("note");
    expect(note1?.domain).toBe("physics");
    expect(note1?.section).toBe("raw");

    const overview = g.nodes.find((n) => n.id === "physics/wiki/overview");
    expect(overview?.domain).toBe("physics");
    expect(overview?.section).toBe("wiki");

    const timeline = g.nodes.find((n) => n.id === "history/raw/timeline");
    expect(timeline?.domain).toBe("history");
    expect(timeline?.section).toBe("raw");

    const tag = g.nodes.find((n) => n.id === "tag:project");
    expect(tag?.type).toBe("tag");
    expect(tag?.domain).toBeUndefined();
    expect(tag?.section).toBeUndefined();

    const edges = g.edges.map((e) => `${e.source}>${e.target}`).sort();
    expect(edges).toEqual(
      [
        "physics/raw/note1>physics/wiki/overview",
        "physics/raw/note1>tag:project",
        "physics/wiki/overview>tag:project",
        "history/raw/timeline>physics/raw/note1",
        "arts/Raw/painting>tag:project",
      ].sort(),
    );
  });
});
