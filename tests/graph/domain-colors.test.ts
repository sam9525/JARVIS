import { describe, it, expect } from "vitest";
import {
  baseNodeColor,
  colorFor,
  domainsOf,
  groupColor,
  groupOf,
} from "../../src/renderer/graph/domain-colors";
import {
  hueFrom,
  hueToHex,
  workspaceHue,
} from "../../src/renderer/graph/workspace-color";
import { COLORS } from "../../src/renderer/graph/graph-colors";
import type { VaultGraph } from "../../src/shared/types";

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

  it("spaces domains evenly from the base hue", () => {
    expect(colorFor("history", domains)).toBe(hueToHex(hueFrom(0, 0, 2)));
    expect(colorFor("physics", domains)).toBe(hueToHex(hueFrom(0, 1, 2)));
  });

  it("gives the first domain the workspace's own hue", () => {
    const hue = workspaceHue("aerograph", ["aerograph", "obsidian"]);
    expect(colorFor("history", domains, hue)).toBe(hueToHex(hue));
  });

  it("gives two projects different colours for the same domain name", () => {
    const ids = ["aerograph", "pokemon-tcg-pocket-data"];
    const a = colorFor("history", domains, workspaceHue(ids[0], ids));
    const b = colorFor("history", domains, workspaceHue(ids[1], ids));
    expect(a).not.toBe(b);
  });

  it("gives every domain in one project a distinct colour", () => {
    const many = ["a", "b", "c", "d", "e", "f"];
    const hue = workspaceHue("obsidian", ["obsidian", "jarvis"]);
    const seen = many.map((d) => colorFor(d, many, hue));
    expect(new Set(seen).size).toBe(many.length);
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

  it("ungrouped notes fall back to the domain hue", () => {
    expect(
      baseNodeColor(
        { id: "history/a", type: "note", domain: "history" },
        domains,
        groups,
      ),
    ).toBe(hueToHex(hueFrom(0, 0, 2)));
  });

  it("passes the base hue through to the domain colour", () => {
    expect(
      baseNodeColor(
        { id: "history/a", type: "note", domain: "history" },
        domains,
        groups,
        90,
      ),
    ).toBe(hueToHex(90));
  });

  it("no group, no domain → fallback grey", () => {
    expect(baseNodeColor({ id: "misc", type: "note" }, domains, groups)).toBe(
      "#4a5568",
    );
  });
});
