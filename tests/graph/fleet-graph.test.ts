import { describe, it, expect } from "vitest";
import {
  buildFleetGraph,
  fleetDomains,
  FLEET_ROOT,
} from "../../src/renderer/graph/fleet-graph";
import { colorFor } from "../../src/renderer/graph/domain-colors";
import {
  hueOfWorkspace,
  hueToHex,
} from "../../src/renderer/graph/workspace-color";
import type { VaultGraph, Workspace } from "../../src/shared/types";

const vaultGraph: VaultGraph = {
  nodes: [
    { id: "AeroGraph", type: "note", domain: "x", section: "wiki" },
    { id: "notes/random", type: "note", domain: "x", section: "wiki" },
  ],
  edges: [{ source: "AeroGraph", target: "notes/random" }],
};
const aeroGraph: VaultGraph = {
  nodes: [
    { id: "src/main.ts", type: "note" },
    { id: "src/util.ts", type: "note" },
  ],
  edges: [{ source: "src/main.ts", target: "src/util.ts" }],
};
const loneGraph: VaultGraph = {
  nodes: [
    { id: "a.ts", type: "note" },
    { id: "b.ts", type: "note" },
  ],
  edges: [{ source: "a.ts", target: "b.ts" }],
};

const workspaces: Workspace[] = [
  { id: "vlt", name: "vault", rootPath: "", kind: "vault" },
  { id: "aero", name: "aerograph", rootPath: "", kind: "code" },
  { id: "lone", name: "lonesome", rootPath: "", kind: "code" },
];
const graphs = new Map<string, VaultGraph>([
  ["vlt", vaultGraph],
  ["aero", aeroGraph],
  ["lone", loneGraph],
]);

describe("buildFleetGraph", () => {
  const fleet = buildFleetGraph(workspaces, graphs);
  const ids = fleet.nodes.map((n) => n.id);
  const hasEdge = (s: string, t: string) =>
    fleet.edges.some((e) => e.source === s && e.target === t);

  it("has a central JARVIS root and one hub per project", () => {
    expect(ids).toContain(FLEET_ROOT);
    expect(ids).toContain("hub::aero");
    expect(ids).toContain("hub::lone");
  });

  it("prefixes node ids uniquely and colours by workspace name", () => {
    expect(new Set(ids).size).toBe(ids.length);
    const main = fleet.nodes.find((n) => n.id === "aero::src/main.ts");
    expect(main?.domain).toBe("aerograph");
  });

  it("draws a real spoke from a matching vault note to the project hub", () => {
    expect(hasEdge("vlt::AeroGraph", "hub::aero")).toBe(true);
  });

  it("falls back to a root spoke when no vault note matches", () => {
    expect(hasEdge(FLEET_ROOT, "hub::lone")).toBe(true);
  });

  it("does not spoke a project to a note that merely contains its name as a substring", () => {
    const f = buildFleetGraph(
      [
        { id: "vlt", name: "vault", rootPath: "", kind: "vault" },
        { id: "app", name: "app", rootPath: "", kind: "code" },
      ],
      new Map<string, VaultGraph>([
        ["vlt", { nodes: [{ id: "mapping", type: "note" }], edges: [] }],
        ["app", { nodes: [{ id: "x.ts", type: "note" }], edges: [] }],
      ]),
    );
    // "app" must not match the note "mapping" — falls back to the root spoke
    expect(
      f.edges.some((e) => e.source === FLEET_ROOT && e.target === "hub::app"),
    ).toBe(true);
    expect(
      f.edges.some(
        (e) => e.source === "vlt::mapping" && e.target === "hub::app",
      ),
    ).toBe(false);
  });

  it("caps a project to 80 nodes", () => {
    const big: VaultGraph = {
      nodes: Array.from({ length: 90 }, (_, i) => ({
        id: `f${i}.ts`,
        type: "note" as const,
      })),
      edges: [],
    };
    const f = buildFleetGraph(
      [{ id: "big", name: "big", rootPath: "", kind: "code" }],
      new Map([["big", big]]),
    );
    const projNodes = f.nodes.filter((n) => n.id.startsWith("big::"));
    expect(projNodes.length).toBe(80);
  });
});

describe("fleetDomains", () => {
  const ws = (id: string, name: string): Workspace =>
    ({ id, name, kind: "code", root: `/${id}` }) as Workspace;

  it("holds a slot for a workspace whose graph has not loaded", () => {
    const all = [ws("a", "AeroGraph"), ws("b", "Pokemon")];
    // only one graph loaded, but both names still get a slot
    expect(fleetDomains(all)).toEqual(["AeroGraph", "JARVIS", "Pokemon"]);
  });

  it("gives a project the same colour in Fleet as in its own graph", () => {
    const all = [ws("a", "AeroGraph"), ws("b", "Pokemon"), ws("c", "Obsidian")];
    for (const w of all) {
      // what Fleet paints the cluster: node.domain is the workspace name,
      // resolved against the fleet domain list at base hue 0
      const inFleet = colorFor(w.name, fleetDomains(all));
      // what the workspace's own graph starts its spread from
      const atHome = hueToHex(hueOfWorkspace(w, all));
      expect(inFleet).toBe(atHome);
    }
  });

  it("gives two projects two different colours", () => {
    const all = [ws("a", "AeroGraph"), ws("b", "Pokemon")];
    expect(colorFor("AeroGraph", fleetDomains(all))).not.toBe(
      colorFor("Pokemon", fleetDomains(all)),
    );
  });
});
