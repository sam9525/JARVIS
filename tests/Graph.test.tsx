/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { vi, describe, it, expect } from "vitest";
import type { VaultGraph } from "../src/shared/types";

// Mock React before any other code or dynamic imports run
vi.mock("react", async () => {
  const actual = (await vi.importActual("react")) as any;
  return {
    ...actual,
    useMemo: (fn: any) => fn(),
    useRef: (initial: any) => ({ current: initial }),
    useEffect: () => {
      return;
    },
  };
});

// Define minimal browser globals before any dynamic imports
const noop = () => {
  return;
};
const mockHead = {
  appendChild: noop,
  insertBefore: noop,
};
(global as any).window = {
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: noop,
  CustomEvent: class {},
  requestAnimationFrame: noop,
  cancelAnimationFrame: noop,
};
(global as any).document = {
  addEventListener: noop,
  removeEventListener: noop,
  createElement: () => ({
    getContext: () => ({}),
    style: {},
    appendChild: noop,
  }),
  getElementsByTagName: (name: string) => {
    if (name === "head") return [mockHead];
    return [];
  },
  head: mockHead,
  createTextNode: () => ({}),
};
Object.defineProperty(global, "navigator", {
  value: { userAgent: "node" },
  writable: true,
  configurable: true,
});

describe("Graph component", () => {
  it("wires sized nodes and sets nodeRelSize to 1", async () => {
    // Dynamic import to prevent hoisting and ensure globals are set first
    const { default: Graph } = await import("../src/renderer/Graph");

    const graph: VaultGraph = {
      nodes: [
        { id: "a", type: "note", domain: "physics", section: "raw" },
        { id: "b", type: "note", domain: "physics", section: "wiki" },
      ],
      edges: [{ source: "a", target: "b" }],
    };
    const stateRef = {
      current: {
        sessionId: null,
        nodes: new Map(),
        pulseAt: 0,
        heat: new Map(),
      },
    };

    const element = Graph({
      graph,
      domains: ["physics"],
      groups: [],
      display: { textFadeThreshold: 10, nodeSize: 2, linkThickness: 3 },
      forces: {
        centerStrength: 1,
        repelStrength: 30,
        linkStrength: 1,
        linkDistance: 30,
      },
      stateRef: stateRef as any,
      onNodeClick: () => {
        return;
      },
    });

    // Check that we got a valid React element
    expect(element).toBeDefined();
    expect(element.props).toBeDefined();

    // In the new implementation, nodeRelSize should be 1 (in the old it's 5)
    expect(element.props.nodeRelSize).toBe(1);

    // nodes carry the BASE radius; multipliers apply via accessors, not in the
    // graphData memo (rebuilding nodes on slider drag would restart the sim)
    const nodes = element.props.graphData.nodes;
    expect(nodes).toBeDefined();
    expect(nodes[0].r).toBeCloseTo(1.5); // degree 1 => base radius 1.5
    expect(element.props.nodeVal(nodes[0])).toBeCloseTo((1.5 * 2) ** 2); // nodeSize=2
    expect(element.props.linkWidth({})).toBe(3); // non-hovered × linkThickness=3
  });

  it("lets thumbnail canvases park but keeps the full view repainting", async () => {
    const { default: Graph } = await import("../src/renderer/Graph");

    const graph: VaultGraph = {
      nodes: [{ id: "a", type: "note", domain: "physics", section: "raw" }],
      edges: [],
    };
    const stateRef = {
      current: {
        sessionId: null,
        nodes: new Map(),
        pulseAt: 0,
        rev: 0,
        heat: new Map(),
      },
    };
    const props = {
      graph,
      domains: ["physics"],
      groups: [],
      display: { textFadeThreshold: 10, nodeSize: 2, linkThickness: 3 },
      forces: {
        centerStrength: 1,
        repelStrength: 30,
        linkStrength: 1,
        linkDistance: 30,
      },
      stateRef: stateRef as any,
      onNodeClick: () => {
        return;
      },
    };

    // the open workspace animates fades, pulses and hover — never park it
    expect(Graph({ ...props } as any).props.autoPauseRedraw).toBe(false);
    // a card has none of those; parking is what stops N idle canvases burning frames
    expect(
      Graph({ ...props, thumbnail: true } as any).props.autoPauseRedraw,
    ).toBe(true);
  });

  it("grows a hot node without touching the radius forceCollide reads", async () => {
    const { default: Graph } = await import("../src/renderer/Graph");

    const graph: VaultGraph = {
      nodes: [
        { id: "a", type: "note", domain: "physics", section: "raw" },
        { id: "b", type: "note", domain: "physics", section: "wiki" },
      ],
      edges: [{ source: "a", target: "b" }],
    };
    const stateRef = {
      current: {
        sessionId: null,
        nodes: new Map(),
        pulseAt: 0,
        heat: new Map([["a", 3]]), // 3 of HEAT_CAP=6 => t=0.5 => scale 1.4
      },
    };

    const element = Graph({
      graph,
      domains: ["physics"],
      groups: [],
      display: { textFadeThreshold: 10, nodeSize: 2, linkThickness: 3 },
      forces: {
        centerStrength: 1,
        repelStrength: 30,
        linkStrength: 1,
        linkDistance: 30,
      },
      stateRef: stateRef as any,
      onNodeClick: () => {
        return;
      },
    } as any) as any;

    const nodes = element.props.graphData.nodes;
    const hot = nodes.find((n: any) => n.id === "a");
    const cold = nodes.find((n: any) => n.id === "b");

    // node.r stays the degree-derived base for BOTH — forceCollide reads it, so
    // heat leaking in here would shove the layout on every count tick
    expect(hot.r).toBeCloseTo(1.5);
    expect(cold.r).toBeCloseTo(1.5);

    // ...the growth lives in the accessor instead
    expect(element.props.nodeVal(hot)).toBeCloseTo((1.5 * 2 * 1.4) ** 2);
    expect(element.props.nodeVal(cold)).toBeCloseTo((1.5 * 2) ** 2);
  });
});
