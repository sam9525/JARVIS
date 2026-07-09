import React, { useEffect, useMemo, useRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import type { ForceGraphMethods } from "react-force-graph-3d";
import type { GraphGroup, Settings, VaultGraph } from "../shared/types";
import { nodeDisplay, type HighlightState } from "./highlight-store";
import { colorFor, groupColor } from "./domain-colors";
import { graphMetrics } from "./graph-metrics";
import { COLORS } from "./graph-colors";
import { useForceTuning, type ForceHandle } from "./use-force-tuning";

type NodeObj = {
  id?: string | number;
  type?: string;
  domain?: string;
  r?: number;
};

type GraphProps = {
  graph: VaultGraph; // may be filtered
  domains: string[]; // from the FULL graph — keeps palette indices stable
  groups: GraphGroup[];
  display: Settings["display"];
  forces: Settings["forces"];
  stateRef: React.MutableRefObject<HighlightState>;
  onNodeClick: (id: string) => void;
};

export default function Graph3D({
  graph,
  domains,
  groups,
  display,
  forces,
  stateRef,
  onNodeClick,
}: GraphProps) {
  const fgRef = useRef<ForceGraphMethods>();

  // Nodes carry the BASE radius only — display.nodeSize applies at paint time
  // so a slider tick doesn't re-bind data and restart the simulation.
  const data = useMemo(() => {
    const m = graphMetrics(graph);
    return {
      nodes: graph.nodes.map((n) => ({ ...n, r: m.radius.get(n.id) ?? 4 })),
      links: graph.edges.map((e) => ({ source: e.source, target: e.target })),
    };
  }, [graph]);

  useForceTuning(
    fgRef as unknown as React.MutableRefObject<ForceHandle | undefined>,
    forces,
  );

  // ponytail: 3D node materials are baked, not repainted every frame like the
  // 2D canvas, so highlight changes need a nudge. Re-run the color accessors
  // 2×/s while any node is highlighted so Read flares fade and Edit marks land.
  // Ceiling: add an animating-window guard if refresh() costs too much on very
  // large vaults.
  useEffect(() => {
    const id = setInterval(() => {
      if (stateRef.current.nodes.size > 0) fgRef.current?.refresh();
    }, 500);
    return () => clearInterval(id);
  }, [stateRef]);

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data}
      backgroundColor={COLORS.bg}
      nodeLabel="id"
      nodeVal={(node: NodeObj) => ((node.r ?? 4) * display.nodeSize) ** 2}
      nodeColor={(node: NodeObj) => {
        const id = String(node.id);
        // highlights always win, then group color, then domain palette
        const d = nodeDisplay(stateRef.current, id, performance.now());
        if (d) return COLORS[d];
        const base =
          node.type === "tag" ? COLORS.tag : colorFor(node.domain, domains);
        return groupColor(id, groups) ?? base;
      }}
      linkColor={() => COLORS.link}
      linkWidth={() => display.linkThickness}
      onNodeClick={(node: NodeObj) => {
        if (node.type === "note") onNodeClick(String(node.id));
      }}
    />
  );
}
