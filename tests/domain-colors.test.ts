import { describe, it, expect } from "vitest";
import {
  baseNodeColor,
  colorFor,
  domainsOf,
  groupColor,
  groupOf,
  PALETTE,
} from "../src/renderer/domain-colors";
import { COLORS } from "../src/renderer/graph-colors";
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

describe("groupOf", () => {
  const groups = [
    { query: "Tech", color: "#aa00ff" },
    { query: "tech/ai", color: "#00ff00" },
  ];

  it("returns the first matching group object", () => {
    expect(groupOf("tech/ai/note", groups)).toBe(groups[0]);
  });

  it("returns undefined when nothing matches", () => {
    expect(groupOf("history/a", groups)).toBeUndefined();
  });

  it("ignores groups with empty or whitespace queries", () => {
    expect(
      groupOf("anything", [{ query: " ", color: "#fff" }]),
    ).toBeUndefined();
  });
});

describe("baseNodeColor", () => {
  const domains = ["history", "physics"];
  const groups = [{ query: "physics", color: "#aa00ff" }];

  it("group color wins over everything", () => {
    expect(
      baseNodeColor(
        { id: "physics/a", type: "note", domain: "physics" },
        domains,
        groups,
      ),
    ).toBe("#aa00ff");
  });

  it("tag nodes get the tag color when ungrouped", () => {
    expect(baseNodeColor({ id: "tag:x", type: "tag" }, domains, groups)).toBe(
      COLORS.tag,
    );
  });

  it("ungrouped notes fall back to the domain palette", () => {
    expect(
      baseNodeColor(
        { id: "history/a", type: "note", domain: "history" },
        domains,
        groups,
      ),
    ).toBe(PALETTE[0]);
  });

  it("no group, no domain → fallback grey", () => {
    expect(baseNodeColor({ id: "misc", type: "note" }, domains, groups)).toBe(
      "#4a5568",
    );
  });
});
