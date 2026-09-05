import { describe, it, expect } from "vitest";
import {
  buildFleetGraph,
  clusterGroups,
  fleetDomains,
  FLEET_ROOT,
} from "../../src/renderer/graph/fleet-graph";
import { colorFor, groupColor } from "../../src/renderer/graph/domain-colors";
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
  { id: "vlt", name: "vault", rootPath: "", kind: "vault", sourceId: "vault" },
  {
    id: "aero",
    name: "aerograph",
    rootPath: "",
    kind: "code",
    sourceId: "gitnexus",
  },
  {
    id: "lone",
    name: "lonesome",
    rootPath: "",
    kind: "code",
    sourceId: "gitnexus",
  },
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
        {
          id: "vlt",
          name: "vault",
          rootPath: "",
          kind: "vault",
          sourceId: "vault",
        },
        {
          id: "app",
          name: "app",
          rootPath: "",
          kind: "code",
          sourceId: "gitnexus",
        },
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
      [
        {
          id: "big",
          name: "big",
          rootPath: "",
          kind: "code",
          sourceId: "gitnexus",
        },
      ],
      new Map([["big", big]]),
    );
    const projNodes = f.nodes.filter((n) => n.id.startsWith("big::"));
    expect(projNodes.length).toBe(80);
  });
});

describe("fleetDomains", () => {
  const ws = (id: string, name: string): Workspace => ({
    id,
    name,
    kind: "code",
    rootPath: `/${id}`,
    sourceId: "gitnexus",
  });

  it("holds a slot for a workspace whose graph has not loaded", () => {
    const all = [ws("a", "AeroGraph"), ws("b", "Pokemon")];
    // only one graph loaded, but both names still get a slot
    expect(fleetDomains(all)).toEqual(["AeroGraph", "JARVIS", "Pokemon"]);
  });

  it("gives an unseeded project the same colour in Fleet as in its own graph", () => {
    const all = [ws("a", "AeroGraph"), ws("b", "Pokemon"), ws("c", "Obsidian")];
    for (const w of all) {
      // what Fleet paints the cluster: node.domain is the workspace name,
      // resolved against the fleet domain list at base hue 0
      const inFleet = colorFor(w.name, fleetDomains(all));
      // what the workspace's own graph starts its spread from, before any
      // colour has been drawn for it
      const atHome = hueToHex(hueOfWorkspace(w, all));
      expect(inFleet).toBe(atHome);
    }
  });

  // Fleet was handed the whole workspace array and home the isSelf-filtered
  // one, so the two lists differed in length and an unseeded project drew a
  // different colour in each. The filter lives here so neither caller can.
  it("leaves the main agent out, whichever list a caller passes", () => {
    const self = { ...ws("self", "Main Agent"), isSelf: true } as Workspace;
    const all = [ws("a", "AeroGraph"), ws("b", "Pokemon"), self];
    expect(fleetDomains(all)).toEqual(["AeroGraph", "JARVIS", "Pokemon"]);
    expect(fleetDomains(all)).toEqual(
      fleetDomains(all.filter((w) => !w.isSelf)),
    );
  });

  it("gives two projects two different colours", () => {
    const all = [ws("a", "AeroGraph"), ws("b", "Pokemon")];
    expect(colorFor("AeroGraph", fleetDomains(all))).not.toBe(
      colorFor("Pokemon", fleetDomains(all)),
    );
  });
});

describe("clusterGroups", () => {
  const ws = (id: string, name: string) => ({
    id,
    name,
    rootPath: id,
    kind: "vault" as const,
    sourceId: "vault",
  });

  it("paints a cluster with its project's stored main colour", () => {
    const all = [ws("d:/a", "Alpha"), ws("d:/b", "Beta")];
    const groups = clusterGroups(all, { "d:/a": "#112233", "d:/b": "#445566" });
    expect(groupColor("d:/a::notes/one", groups)).toBe("#112233");
    expect(groupColor("hub::d:/b", groups)).toBe("#445566"); // the hub too
  });

  it("skips a project that has drawn no colour yet", () => {
    const all = [ws("d:/a", "Alpha"), ws("d:/b", "Beta")];
    const groups = clusterGroups(all, { "d:/a": "#112233" });
    expect(groups).toHaveLength(1);
    expect(groupColor("d:/b::notes/one", groups)).toBeUndefined();
  });

  it("matches the longer id when one project id prefixes another", () => {
    const all = [ws("d:/a", "A"), ws("d:/ab", "AB")];
    const groups = clusterGroups(all, {
      "d:/a": "#111111",
      "d:/ab": "#222222",
    });
    expect(groupColor("d:/ab::notes/one", groups)).toBe("#222222");
  });
});
