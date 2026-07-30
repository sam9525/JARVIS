import { describe, it, expect } from "vitest";
import {
  ringLayout,
  snapRotation,
  rotationTo,
} from "../../src/renderer/graph/ring-layout";

describe("ringLayout", () => {
  it("returns no tiles and centeredIndex -1 for an empty ring", () => {
    expect(ringLayout(0, 0)).toEqual({ tiles: [], centeredIndex: -1 });
  });

  it("spaces tiles evenly, tile 0 centred at rotation 0", () => {
    const { tiles, centeredIndex } = ringLayout(4, 0);
    expect(tiles.map((t) => t.angle)).toEqual([0, 90, -180, -90]);
    expect(centeredIndex).toBe(0);
    expect(tiles[0].centered).toBe(true);
    expect(tiles.filter((t) => t.centered)).toHaveLength(1);
  });

  it("puts the front tile at full depth and the back tile at zero", () => {
    const { tiles } = ringLayout(4, 0);
    expect(tiles[0].depth).toBeCloseTo(1);
    expect(tiles[2].depth).toBeCloseTo(0);
  });

  it("places the front tile at x 0 / y 1 and side tiles at x ±1", () => {
    const { tiles } = ringLayout(4, 0);
    expect(tiles[0].x).toBeCloseTo(0);
    expect(tiles[0].y).toBeCloseTo(1);
    expect(tiles[1].x).toBeCloseTo(1);
    expect(tiles[3].x).toBeCloseTo(-1);
  });

  it("advances centeredIndex with rotation", () => {
    expect(ringLayout(4, 90).centeredIndex).toBe(1);
    expect(ringLayout(4, 180).centeredIndex).toBe(2);
  });

  it("wraps around: a full turn re-centres tile 0, negative rotation counts back", () => {
    expect(ringLayout(4, 360).centeredIndex).toBe(0);
    expect(ringLayout(4, -90).centeredIndex).toBe(3);
  });
});

describe("snapRotation", () => {
  it("snaps to the nearest tile step", () => {
    expect(snapRotation(100, 4)).toBe(90);
    expect(snapRotation(140, 4)).toBe(180);
    expect(snapRotation(-100, 4)).toBe(-90);
  });

  it("keeps a resting rotation where it is", () => {
    expect(snapRotation(270, 4)).toBe(270);
  });

  it("is a no-op on an empty ring", () => {
    expect(snapRotation(33, 0)).toBe(33);
  });
});

describe("rotationTo", () => {
  it("rotates a tile to centre", () => {
    expect(rotationTo(1, 0, 4)).toBe(90);
  });

  it("takes the shortest path across the wrap point", () => {
    // tile 0 from rotation 350 is 10° forward, not 350° back
    expect(rotationTo(0, 350, 4)).toBe(360);
  });

  it("leaves the centred tile alone", () => {
    expect(rotationTo(2, 180, 4)).toBe(180);
  });
});
