import { describe, it, expect } from "vitest";
import {
  canSnapshot,
  isStill,
  lookKey,
  snapshotValid,
} from "../../src/renderer/graph/card-snapshot";
import type { CardSnapshot } from "../../src/renderer/graph/card-snapshot";
import {
  emptyState,
  MATCH_MS,
  PULSE_MS,
} from "../../src/renderer/session/highlight-store";
import type { GraphGroup, VaultGraph } from "../../src/shared/types";

const g: VaultGraph = { nodes: [{ id: "a", type: "note" }], edges: [] };

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
  dpr: 1,
});

function defaultView() {
  return {} as Parameters<typeof lookKey>[0]["view"];
}

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
  it("is equal for equal-but-fresh objects and differs when a value changes", () => {
    expect(lookKey(partsOf(200))).toBe(lookKey(partsOf(200)));
    expect(lookKey(partsOf(201))).not.toBe(lookKey(partsOf(200)));
    expect(lookKey({ ...partsOf(200), dpr: 2 })).not.toBe(
      lookKey(partsOf(200)),
    );
  });
});

describe("snapshotValid", () => {
  const snap: CardSnapshot = {
    url: "data:image/png;base64,x",
    inputs: { graph: g, rev: 3, look: "k" },
  };
  it("needs the same graph object, rev and look", () => {
    expect(snapshotValid(undefined, snap.inputs)).toBe(false);
    expect(snapshotValid(snap, { graph: g, rev: 3, look: "k" })).toBe(true);
    expect(snapshotValid(snap, { graph: { ...g }, rev: 3, look: "k" })).toBe(
      false,
    );
    expect(snapshotValid(snap, { graph: g, rev: 4, look: "k" })).toBe(false);
    expect(snapshotValid(snap, { graph: g, rev: 3, look: "other" })).toBe(
      false,
    );
  });
});

describe("isStill", () => {
  it("is false while a pulse or match is animating", () => {
    expect(isStill(emptyState(), 5000)).toBe(true);

    const pulsing = { ...emptyState(), pulseAt: 1000 };
    expect(isStill(pulsing, 1100)).toBe(false);
    expect(isStill(pulsing, 1000 + PULSE_MS)).toBe(true);

    const matching = { ...emptyState(), matchAt: 1000 };
    expect(isStill(matching, 1100)).toBe(false);
    expect(isStill(matching, 1000 + MATCH_MS)).toBe(true);
  });
});
