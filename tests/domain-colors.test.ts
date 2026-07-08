import { describe, it, expect } from "vitest";
import { colorFor, domainsOf, PALETTE } from "../src/renderer/domain-colors";
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
    expect(colorFor("history", domains, {})).toBe(PALETTE[0]);
    expect(colorFor("physics", domains, {})).toBe(PALETTE[1]);
  });

  it("custom color overrides the palette", () => {
    expect(colorFor("physics", domains, { physics: "#123456" })).toBe(
      "#123456",
    );
  });

  it("wraps past the palette length", () => {
    const many = Array.from({ length: PALETTE.length + 1 }, (_, i) =>
      String(i).padStart(3, "0"),
    );
    expect(colorFor(many[PALETTE.length], many, {})).toBe(PALETTE[0]);
  });

  it("falls back to grey for undefined or unknown domains", () => {
    expect(colorFor(undefined, domains, {})).toBe("#4a5568");
    expect(colorFor("nope", domains, {})).toBe("#4a5568");
  });
});
