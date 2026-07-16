import { describe, it, expect } from "vitest";
import { resolveWikilink, buildWikilinkResolver } from "../src/shared/wikilink";

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

describe("buildWikilinkResolver", () => {
  const resolve = buildWikilinkResolver([
    "notes/beta",
    "physics/wiki/overview",
  ]);

  it("resolves exact vault-relative path", () => {
    expect(resolve("notes/beta")).toBe("notes/beta");
  });
  it("resolves case-insensitive path", () => {
    expect(resolve("Notes/Beta")).toBe("notes/beta");
  });
  it("resolves bare basename", () => {
    expect(resolve("overview")).toBe("physics/wiki/overview");
  });
  it("strips .md before resolving", () => {
    expect(resolve("notes/beta.md")).toBe("notes/beta");
  });
  it("returns null for unknown targets", () => {
    expect(resolve("ghost")).toBeNull();
  });
});
