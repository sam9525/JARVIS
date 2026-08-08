// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect } from "vitest";
import {
  fitHalo,
  useGroupHalos,
} from "../../src/renderer/graph/use-group-halos";
import { NO_GROUPS } from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("useGroupHalos", () => {
  it("a re-render with NO_GROUPS does not tear down and rebuild the halos", () => {
    // scene() runs exactly once per effect execution — its call count IS the
    // effect-run count, which stays 1 only if the deps hold their identity
    const scene = vi.fn(() => ({ add: vi.fn(), remove: vi.fn() }));
    const fgRef = { current: { scene } } as any;
    const nodes: never[] = [];
    function Probe() {
      useGroupHalos(fgRef, nodes, NO_GROUPS);
      return null;
    }
    const container = document.createElement("div");
    let root!: Root;
    act(() => {
      root = createRoot(container);
      root.render(<Probe />);
    });
    act(() => root.render(<Probe />));
    expect(scene).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
