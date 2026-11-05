import { describe, it, expect, beforeEach } from "vitest";
import {
  canSnapshot,
  dropSnapshot,
  loadStoredSnapshots,
  lookKey,
  snapshots,
  snapshotValid,
} from "../../src/renderer/graph/card-snapshot";
import type { CardSnapshot } from "../../src/renderer/graph/card-snapshot";
import { SNAPSHOT_FORMAT } from "../../src/shared/types";
import type {
  CardLayout,
  GraphGroup,
  StoredSnapshot,
  VaultGraph,
} from "../../src/shared/types";

const g: VaultGraph = { nodes: [{ id: "a", type: "note" }], edges: [] };

const layout: CardLayout = {
  width: 220,
  height: 150,
  transform: { k: 1, x: 0, y: 0 },
  nodes: [{ id: "a", hk: "a", x: 1, y: 2, r: 4, fill: "#112233" }],
  links: [],
};

const partsOf = (baseHue: number) => ({
  baseHue,
  groups: [] as GraphGroup[],
  view: { ...defaultView() },
  filters: {
    sectionFilter: "both" as const,
    showTags: true,
    showOrphans: true,
  },
  width: 320,
  height: 200,
});

function defaultView() {
  return {} as Parameters<typeof lookKey>[0]["view"];
}

const stored = (id: string, look: string): StoredSnapshot => ({
  format: SNAPSHOT_FORMAT,
  id,
  fingerprint: "vault:x",
  look,
  layout,
});

beforeEach(() => snapshots.clear());

describe("canSnapshot", () => {
  it("refuses null, failed and empty graphs", () => {
    expect(canSnapshot(null)).toBe(false);
    expect(canSnapshot({ ...g, failed: "GitNexus read failed, refresh" })).toBe(
      false,
    );
    expect(canSnapshot({ nodes: [], edges: [] })).toBe(false);
    expect(canSnapshot(g)).toBe(true);
  });
});

describe("lookKey", () => {
  it("is equal for equal-but-fresh parts", () => {
    expect(lookKey(partsOf(200))).toBe(lookKey(partsOf(200)));
  });

  it("differs when the hue or the format differs", () => {
    expect(lookKey(partsOf(201))).not.toBe(lookKey(partsOf(200)));
    const otherFormat = JSON.stringify({
      format: SNAPSHOT_FORMAT + 1,
      ...partsOf(200),
    });
    expect(lookKey(partsOf(200))).not.toBe(otherFormat);
    expect(JSON.parse(lookKey(partsOf(200))).format).toBe(SNAPSHOT_FORMAT);
  });
});

describe("snapshotValid", () => {
  const snap: CardSnapshot = { look: "k", layout };
  it("needs a snapshot with the same look", () => {
    expect(snapshotValid(undefined, "k")).toBe(false);
    expect(snapshotValid(snap, "other")).toBe(false);
    expect(snapshotValid(snap, "k")).toBe(true);
  });
});

describe("loadStoredSnapshots", () => {
  it("replaces the map with the stored looks and layouts", () => {
    snapshots.set("old", { look: "x", layout });
    loadStoredSnapshots([stored("w1", "k1"), stored("w2", "k2")]);
    expect([...snapshots.keys()].sort()).toEqual(["w1", "w2"]);
    expect(snapshots.get("w1")).toEqual({ look: "k1", layout });
  });
});

describe("dropSnapshot", () => {
  it("removes the entry", () => {
    snapshots.set("w1", { look: "k", layout });
    dropSnapshot("w1");
    expect(snapshots.has("w1")).toBe(false);
  });
});
