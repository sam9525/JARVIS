import { describe, it, expect } from "vitest";
import { fitHalo } from "../../src/renderer/graph/use-group-halos";

describe("fitHalo", () => {
  it("returns undefined for an empty group", () => {
    expect(fitHalo([])).toBeUndefined();
  });

  it("centers a single node with the base radius", () => {
    expect(fitHalo([{ x: 10, y: -4, z: 2 }])).toEqual({
      x: 10,
      y: -4,
      z: 2,
      r: 10,
    });
  });

  it("covers the farthest member plus 10% padding", () => {
    const fit = fitHalo([
      { x: -10, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ]);
    expect(fit).toEqual({ x: 0, y: 0, z: 0, r: 10 * 1.1 + 10 });
  });

  it("treats missing coordinates as origin", () => {
    expect(fitHalo([{}])).toEqual({ x: 0, y: 0, z: 0, r: 10 });
  });
});
