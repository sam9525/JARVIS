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
    useCallback: (fn: any) => fn,
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

export function makeProps(graph: VaultGraph) {
  return {
    graph,
    domains: ["physics"],
    groups: [],
    display: { textFadeThreshold: 15, nodeSize: 0.5, linkThickness: 0.5 },
    forces: {
      centerStrength: 0,
      repelStrength: 20,
      linkStrength: 0.4,
      linkDistance: 60,
    },
    stateRef: { current: { sessionId: null, nodes: new Map(), pulseAt: 0 } },
    onNodeClick: noop,
  };
}

export const sampleGraph: VaultGraph = {
  nodes: [
    { id: "physics/a", type: "note", domain: "physics", section: "wiki" },
    { id: "physics/b", type: "note", domain: "physics", section: "wiki" },
  ],
  edges: [{ source: "physics/a", target: "physics/b" }],
};

describe("Graph3D component", () => {
  it("renders 16-segment spheres", async () => {
    const { default: Graph3D } = await import("../src/renderer/Graph3D");
    const element = Graph3D(makeProps(sampleGraph) as any) as any;
    expect(element.props.nodeResolution).toBe(16);
  });

  it("extends nodes with label sprites instead of replacing them", async () => {
    const { default: Graph3D } = await import("../src/renderer/Graph3D");
    const element = Graph3D(makeProps(sampleGraph) as any) as any;
    expect(element.props.nodeThreeObjectExtend).toBe(true);
    expect(typeof element.props.nodeThreeObject).toBe("function");
  });

  it("fits the graph to view once the engine settles", async () => {
    const { default: Graph3D } = await import("../src/renderer/Graph3D");
    const element = Graph3D(makeProps(sampleGraph) as any) as any;
    expect(element.props.cooldownTicks).toBe(200);
    expect(typeof element.props.onEngineStop).toBe("function");
  });
});
