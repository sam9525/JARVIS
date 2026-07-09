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
      current: { sessionId: null, nodes: new Map(), pulseAt: 0 },
    };

    const element = Graph({
      graph,
      domains: ["physics"],
      domainColors: { physics: "#ff0000" },
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

    // In the new implementation, nodes should have calculated r and val.
    // In the old implementation, nodes don't have r and val.
    const nodes = element.props.graphData.nodes;
    expect(nodes).toBeDefined();
    expect(nodes[0].r).toBeCloseTo(3.5); // degree 1 => radius 3.5
    expect(nodes[0].val).toBeCloseTo(3.5 * 3.5);
  });
});
