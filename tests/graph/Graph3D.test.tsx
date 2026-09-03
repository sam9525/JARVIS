/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { vi, describe, it, expect } from "vitest";
import type { VaultGraph } from "../../src/shared/types";
import { hueToHex } from "../../src/renderer/graph/workspace-color";

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
    display: {
      textFadeThreshold: 15,
      nodeSize: 0.5,
      linkThickness: 0.5,
      nodeOpacity: 0.5,
      linkOpacity: 0.25,
      haloPad: 1.1,
      haloBase: 10,
    },
    forces: {
      centerStrength: 0,
      repelStrength: 20,
      linkStrength: 0.4,
      linkDistance: 60,
    },
    stateRef: {
      current: {
        sessionId: null,
        nodes: new Map(),
        pulseAt: 0,
        heat: new Map(),
      },
    },
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
    const { default: Graph3D } =
      await import("../../src/renderer/graph/Graph3D");
    const element = Graph3D(makeProps(sampleGraph) as any) as any;
    expect(element.props.nodeResolution).toBe(16);
  });

  it("extends nodes with label sprites instead of replacing them", async () => {
    const { default: Graph3D } =
      await import("../../src/renderer/graph/Graph3D");
    const element = Graph3D(makeProps(sampleGraph) as any) as any;
    expect(element.props.nodeThreeObjectExtend).toBe(true);
    expect(typeof element.props.nodeThreeObject).toBe("function");
  });

  it("fits the graph to view once the engine settles", async () => {
    const { default: Graph3D } =
      await import("../../src/renderer/graph/Graph3D");
    const element = Graph3D(makeProps(sampleGraph) as any) as any;
    expect(element.props.cooldownTicks).toBe(300);
    expect(typeof element.props.onEngineStop).toBe("function");
  });

  it("uses orbit controls so the scene can auto-rotate when idle", async () => {
    const { default: Graph3D } =
      await import("../../src/renderer/graph/Graph3D");
    const element = Graph3D(makeProps(sampleGraph) as any) as any;
    expect(element.props.controlType).toBe("orbit");
  });

  it("renders links as custom gradient objects", async () => {
    const { default: Graph3D } =
      await import("../../src/renderer/graph/Graph3D");
    const element = Graph3D(makeProps(sampleGraph) as any) as any;
    expect(typeof element.props.linkThreeObject).toBe("function");
    expect(typeof element.props.linkPositionUpdate).toBe("function");
    expect(element.props.linkColor).toBeUndefined();
    expect(element.props.linkWidth).toBeUndefined();
  });

  it("lite mode hides the library's links and drives merged ones per tick", async () => {
    const { default: Graph3D } =
      await import("../../src/renderer/graph/Graph3D");
    const props = { ...makeProps(sampleGraph), lite: true } as any;
    const element = Graph3D(props) as any;
    expect(element.props.nodeResolution).toBe(10);
    expect(element.props.linkVisibility).toBe(false);
    expect(element.props.linkThreeObject).toBeUndefined();
    expect(typeof element.props.onEngineTick).toBe("function");
  });

  it("grows a hot node through nodeVal, leaving node.r for forceCollide", async () => {
    const { default: Graph3D } =
      await import("../../src/renderer/graph/Graph3D");

    const props = makeProps(sampleGraph) as any;
    props.stateRef.current.heat = new Map([["physics/a", 6]]); // full heat
    const element = Graph3D(props) as any;

    const nodes = element.props.graphData.nodes;
    const hot = nodes.find((n: any) => n.id === "physics/a");
    const cold = nodes.find((n: any) => n.id === "physics/b");

    expect(hot.r).toBeCloseTo(1.5); // untouched — forceCollide reads this
    expect(element.props.nodeVal(hot)).toBeCloseTo((1.5 * 0.5 * 1.8) ** 2);
    expect(element.props.nodeVal(cold)).toBeCloseTo((1.5 * 0.5) ** 2);
  });

  it("brightens a hot node's colour without discarding its base colour", async () => {
    const { default: Graph3D } =
      await import("../../src/renderer/graph/Graph3D");

    const props = makeProps(sampleGraph) as any;
    props.stateRef.current.heat = new Map([["physics/a", 6]]);
    const element = Graph3D(props) as any;

    const cold = element.props.nodeColor({
      id: "physics/b",
      domain: "physics",
    });
    const hot = element.props.nodeColor({ id: "physics/a", domain: "physics" });
    expect(cold).toBe(hueToHex(0)); // first domain wears the base hue itself
    expect(hot).not.toBe(cold);
    expect(hot).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("colours a node from the workspace base hue it is given", async () => {
    const { default: Graph3D } =
      await import("../../src/renderer/graph/Graph3D");

    const props = makeProps(sampleGraph) as any;
    props.baseHue = 207;
    const node = { id: "physics/b", domain: "physics" };
    expect((Graph3D(props) as any).props.nodeColor(node)).toBe(hueToHex(207));
  });

  it("colours impact nodes with tier colours, overridden by modified", async () => {
    const { default: Graph3D } =
      await import("../../src/renderer/graph/Graph3D");
    const { RADIUS_COLOR, COLORS } =
      await import("../../src/renderer/graph/graph-colors");

    const props = makeProps(sampleGraph) as any;
    props.stateRef.current.impacted = new Map([
      ["physics/a", 0],
      ["physics/b", 1],
    ]);
    const element = Graph3D(props) as any;

    const nodeA = { id: "physics/a", domain: "physics" };
    const nodeB = { id: "physics/b", domain: "physics" };
    expect(element.props.nodeColor(nodeA)).toBe(RADIUS_COLOR);
    expect(element.props.nodeColor(nodeB)).not.toBe(RADIUS_COLOR);

    // modified takes precedence over impact
    props.stateRef.current.nodes = new Map([
      ["physics/a", { kind: "modified" }],
    ]);
    const elementMod = Graph3D(props) as any;
    expect(elementMod.props.nodeColor(nodeA)).toBe(COLORS.modified);
  });
});
