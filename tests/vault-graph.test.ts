import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanVault, toNodeId } from "../src/main/vault-graph";

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
