import { describe, it, expect } from "vitest";
import {
  colorFor,
  domainsOf,
  groupColor,
  PALETTE,
} from "../src/renderer/domain-colors";
import type { VaultGraph } from "../src/shared/types";

const g: VaultGraph = {
  nodes: [
    { id: "physics/raw/a", type: "note", domain: "physics", section: "raw" },
    { id: "physics/wiki/b", type: "note", domain: "physics", section: "wiki" },
    { id: "history/raw/c", type: "note", domain: "history", section: "raw" },
    { id: "tag:x", type: "tag" },
  ],
  edges: [],
};

describe("domainsOf", () => {
  it("returns sorted unique domains, ignoring tag nodes", () => {
    expect(domainsOf(g)).toEqual(["history", "physics"]);
  });
});

describe("colorFor", () => {
  const domains = ["history", "physics"];

  it("assigns palette colors by sorted index", () => {
    expect(colorFor("history", domains)).toBe(PALETTE[0]);
    expect(colorFor("physics", domains)).toBe(PALETTE[1]);
  });

  it("wraps past the palette length", () => {
    const many = Array.from({ length: PALETTE.length + 1 }, (_, i) =>
      String(i).padStart(3, "0"),
    );
    expect(colorFor(many[PALETTE.length], many)).toBe(PALETTE[0]);
  });

  it("falls back to grey for undefined or unknown domains", () => {
    expect(colorFor(undefined, domains)).toBe("#4a5568");
    expect(colorFor("nope", domains)).toBe("#4a5568");
  });
});

describe("groupColor", () => {
  const groups = [
    { query: "Tech", color: "#aa00ff" },
    { query: "tech/ai", color: "#00ff00" },
  ];

  it("first matching group wins", () => {
    expect(groupColor("tech/ai/note", groups)).toBe("#aa00ff");
  });

  it("matches case-insensitively", () => {
    expect(groupColor("TECH/x", groups)).toBe("#aa00ff");
  });

  it("ignores groups with empty or whitespace queries", () => {
    expect(
      groupColor("anything", [{ query: "  ", color: "#ffffff" }]),
    ).toBeUndefined();
  });

  it("returns undefined when nothing matches", () => {
    expect(groupColor("history/a", groups)).toBeUndefined();
  });
});
