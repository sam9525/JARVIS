import { describe, it, expect } from "vitest";
import {
  MIN_GROUP_NODES,
  seedGroups,
} from "../../src/renderer/graph/seed-groups";
import type { GraphNode, VaultGraph } from "../../src/shared/types";

const notes = (domain: string, n: number): GraphNode[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${domain}/${i}`,
    type: "note",
    domain,
  }));

const graph = (sizes: Record<string, number>): VaultGraph => ({
  nodes: Object.entries(sizes).flatMap(([d, n]) => notes(d, n)),
  edges: [],
});

describe("seedGroups", () => {
  it("draws hues only for folders that get a stored group", () => {
    const seeded = seedGroups(
      graph({ big: 20, docs: 2, scripts: MIN_GROUP_NODES, src: 9 }),
      [],
    );
    expect(seeded?.groups.map((x) => x.query)).toEqual(["big/", "src/"]);
    expect(seeded?.hues).toHaveLength(2);
  });

  it("gives the biggest kept folder's colour to the workspace", () => {
    const seeded = seedGroups(graph({ a: 7, b: 30, c: 8 }), []);
    expect(seeded?.main).toBe(seeded?.groups[1].color);
  });

  it("draws one hue for the main colour when no folder is kept", () => {
    const seeded = seedGroups(graph({ docs: 2, rules: 3 }), []);
    expect(seeded?.groups).toEqual([]);
    expect(seeded?.hues).toHaveLength(1);
    expect(seeded?.main).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("returns null for a graph with no folders yet", () => {
    expect(seedGroups({ nodes: [], edges: [] }, [])).toBeNull();
  });
});
