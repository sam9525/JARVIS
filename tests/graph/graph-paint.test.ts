import { describe, it, expect } from "vitest";
import {
  paintLayout,
  paintNode,
  paintOverlay,
} from "../../src/renderer/graph/graph-paint";
import { displayRadius } from "../../src/renderer/graph/graph-metrics";
import { COLORS } from "../../src/renderer/graph/graph-colors";
import { emptyState } from "../../src/renderer/session/highlight-store";
import type { CardLayout, LayoutNode } from "../../src/shared/types";

type Call = [string, ...unknown[]];

// Records every method call as [name, ...args] and every style assignment as
// ["set:<prop>", value], so a test reads the drawing as a sequence.
function recordingCtx() {
  const calls: Call[] = [];
  const target: Record<string, unknown> = {};
  for (const prop of ["fillStyle", "strokeStyle", "lineWidth", "globalAlpha"]) {
    let value: unknown;
    Object.defineProperty(target, prop, {
      get: () => value,
      set: (v) => {
        value = v;
        calls.push([`set:${prop}`, v]);
      },
    });
  }
  const ctx = new Proxy(target, {
    get: (t, name: string) =>
      name in t ? t[name] : (...args: unknown[]) => calls.push([name, ...args]),
    set: (t, name: string, v) => {
      t[name] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const node = (over: Partial<LayoutNode> = {}): LayoutNode => ({
  id: "a",
  hk: "a",
  x: 10,
  y: 20,
  r: 4,
  fill: "#336699",
  ...over,
});

const opts = { nodeSize: 1.5, globalScale: 2 };
const named = (calls: Call[], name: string) =>
  calls.filter((c) => c[0] === name);

describe("paintNode", () => {
  it("draws a cold node as one disc in its fill, with no ring", () => {
    const { ctx, calls } = recordingCtx();
    paintNode(ctx, node(), emptyState(), opts);
    expect(named(calls, "arc")).toEqual([
      ["arc", 10, 20, displayRadius(4, 1.5, 0), 0, 2 * Math.PI],
    ]);
    expect(named(calls, "set:fillStyle")).toEqual([
      ["set:fillStyle", "#336699"],
    ]);
    expect(named(calls, "stroke")).toEqual([]);
  });

  it("rings a modified node in the modified colour", () => {
    const s = emptyState();
    s.nodes.set("a", { kind: "modified", read: false });
    const { ctx, calls } = recordingCtx();
    paintNode(ctx, node(), s, opts);
    const r = displayRadius(4, 1.5, 0);
    expect(named(calls, "arc")[1]).toEqual([
      "arc",
      10,
      20,
      r + 2.5 / 2,
      0,
      2 * Math.PI,
    ]);
    expect(named(calls, "set:strokeStyle")).toEqual([
      ["set:strokeStyle", COLORS.modified],
    ]);
    expect(named(calls, "stroke")).toHaveLength(1);
  });

  it("rings a read node in the ring colour", () => {
    const s = emptyState();
    s.nodes.set("a", { kind: "read" });
    const { ctx, calls } = recordingCtx();
    paintNode(ctx, node(), s, opts);
    const r = displayRadius(4, 1.5, 0);
    expect(named(calls, "arc")[1]).toEqual([
      "arc",
      10,
      20,
      r + 2.5 / 2,
      0,
      2 * Math.PI,
    ]);
    expect(named(calls, "set:strokeStyle")).toEqual([
      ["set:strokeStyle", COLORS.ring],
    ]);
  });

  it("puts the read ring outside the modified ring on a node that is both", () => {
    const s = emptyState();
    s.nodes.set("a", { kind: "modified", read: true });
    const { ctx, calls } = recordingCtx();
    paintNode(ctx, node(), s, opts);
    const r = displayRadius(4, 1.5, 0);
    expect(named(calls, "arc")[2]).toEqual([
      "arc",
      10,
      20,
      r + 4.5 / 2,
      0,
      2 * Math.PI,
    ]);
    expect(named(calls, "set:strokeStyle")).toEqual([
      ["set:strokeStyle", COLORS.modified],
      ["set:strokeStyle", COLORS.ring],
    ]);
  });
});

describe("paintOverlay", () => {
  it("draws one line and one arrowhead for a trail of two nodes", () => {
    const a = node({ id: "a", hk: "a", x: 0, y: 0 });
    const b = node({ id: "b", hk: "b", x: 100, y: 0 });
    const s = emptyState();
    s.trail = ["a", "b"];
    const { ctx, calls } = recordingCtx();
    paintOverlay(
      ctx,
      [a, b],
      new Map([
        ["a", a],
        ["b", b],
      ]),
      s,
      { ...opts, now: 0, pulseReach: 600 },
    );
    expect(named(calls, "stroke")).toHaveLength(1);
    expect(named(calls, "fill")).toHaveLength(1);
    expect(named(calls, "closePath")).toHaveLength(1);
  });
});

describe("paintLayout", () => {
  const layout: CardLayout = {
    width: 200,
    height: 100,
    transform: { k: 0.5, x: 30, y: -10 },
    nodes: [node({ id: "a", x: 0, y: 0 }), node({ id: "b", x: 50, y: 0 })],
    links: [[0, 1]],
  };

  it("maps graph space onto the canvas through the stored transform", () => {
    const { ctx, calls } = recordingCtx();
    paintLayout(ctx, layout, emptyState(), {
      nodeSize: 1,
      linkThickness: 1,
      dpr: 2,
      now: 0,
    });
    const k = 0.5;
    expect(named(calls, "setTransform")).toContainEqual([
      "setTransform",
      2 * k,
      0,
      0,
      2 * k,
      2 * (200 / 2 - k * 30),
      2 * (100 / 2 - k * -10),
    ]);
  });

  it("strokes one path per link, before the nodes", () => {
    const { ctx, calls } = recordingCtx();
    paintLayout(ctx, layout, emptyState(), {
      nodeSize: 1,
      linkThickness: 1.5,
      dpr: 1,
      now: 0,
    });
    expect(named(calls, "stroke")).toHaveLength(1);
    expect(calls).toContainEqual(["set:strokeStyle", COLORS.link]);
    expect(calls).toContainEqual(["set:lineWidth", 1.5 / 0.5]);
    expect(named(calls, "lineTo")).toEqual([["lineTo", 50, 0]]);
    const strokeAt = calls.findIndex((c) => c[0] === "stroke");
    const firstArc = calls.findIndex((c) => c[0] === "arc");
    expect(strokeAt).toBeLessThan(firstArc);
  });
});
