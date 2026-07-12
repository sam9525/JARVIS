import React, { useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { GraphGroup, Settings, VaultGraph } from "../shared/types";
import {
  nodeDisplay,
  pulseProgress,
  type HighlightState,
} from "./highlight-store";
import { colorFor, groupColor } from "./domain-colors";
import { graphMetrics } from "./graph-metrics";
import { COLORS } from "./graph-colors";
import { useForceTuning, type ForceHandle } from "./use-force-tuning";
import { nodeLabelText } from "./node-label";

const ZOOM = { min: 0.5, max: 15 } as const;

type NodeObj = {
  id?: string | number;
  type?: string;
  domain?: string;
  x?: number;
  y?: number;
  r?: number;
};

type LinkEnd = string | { id?: string | number };
type LinkObj = { source?: LinkEnd; target?: LinkEnd };

// force-graph swaps link ends from id strings to node objects once it binds data
function endId(end: LinkEnd | undefined): string {
  return typeof end === "object" && end !== null ? String(end.id) : String(end);
}

type GraphProps = {
  graph: VaultGraph; // may be filtered
  domains: string[]; // from the FULL graph — keeps palette indices stable
  groups: GraphGroup[];
  display: Settings["display"];
  forces: Settings["forces"];
  stateRef: React.MutableRefObject<HighlightState>;
  onNodeClick: (id: string) => void;
};

export default function Graph({
  graph,
  domains,
  groups,
  display,
  forces,
  stateRef,
  onNodeClick,
}: GraphProps) {
  // hover lives in a ref, not state: the canvas repaints every frame anyway (autoPauseRedraw=false)
  const hoverRef = useRef<{ id: string; neighbors: Set<string> } | null>(null);
  const fgRef = useRef<ForceGraphMethods>();
  const didFit = useRef(false); // fit-to-screen once, not on every re-settle

  // force-graph mutates node objects (x/y); hand it copies so React state stays clean.
  // Nodes carry the BASE radius only — display.nodeSize applies at paint time,
  // otherwise every slider tick would re-bind data and restart the simulation.
  const { data, neighbors } = useMemo(() => {
    const m = graphMetrics(graph);
    return {
      data: {
        nodes: graph.nodes.map((n) => ({ ...n, r: m.radius.get(n.id) ?? 4 })),
        links: graph.edges.map((e) => ({ source: e.source, target: e.target })),
      },
      neighbors: m.neighbors,
    };
  }, [graph]);

  useForceTuning(
    fgRef as unknown as React.MutableRefObject<ForceHandle | undefined>,
    forces,
  );

  const linkHovered = (l: LinkObj) => {
    const h = hoverRef.current;
    return h !== null && (endId(l.source) === h.id || endId(l.target) === h.id);
  };

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={data}
      backgroundColor={COLORS.bg}
      autoPauseRedraw={false} // keep repainting so flares fade, pulses ripple, hover tracks
      nodeRelSize={1}
      minZoom={ZOOM.min}
      maxZoom={ZOOM.max}
      cooldownTicks={200} // settle in ~1-2s instead of the default 15s so the fit fires promptly
      onEngineStop={() => {
        if (didFit.current) return;
        didFit.current = true;
        fgRef.current?.zoomToFit(200, 40);
      }}
      nodeLabel="id"
      nodeVal={(node: NodeObj) => ((node.r ?? 4) * display.nodeSize) ** 2}
      nodeCanvasObject={(
        node: NodeObj,
        ctx: CanvasRenderingContext2D,
        globalScale: number,
      ) => {
        if (node.x === undefined || node.y === undefined) return;
        const id = String(node.id);
        const r = (node.r ?? 4) * display.nodeSize;
        const d = nodeDisplay(stateRef.current, id, performance.now());
        const base =
          node.type === "tag" ? COLORS.tag : colorFor(node.domain, domains);
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        // highlights always win, then group color, then domain palette
        ctx.fillStyle = d ? COLORS[d] : (groupColor(id, groups) ?? base);
        ctx.fill();

        const h = hoverRef.current;
        const inHover = h !== null && (id === h.id || h.neighbors.has(id));
        if (inHover) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 1.5 / globalScale, 0, 2 * Math.PI);
          ctx.strokeStyle = COLORS.hover;
          ctx.lineWidth = 1 / globalScale;
          ctx.stroke();
        }

        // labels hide on small nodes; hover overrides so neighbors stay readable
        if (r * globalScale < display.textFadeThreshold && !inHover) return;
        const label = nodeLabelText(id, node.type);
        const fontSize = 12 / globalScale;
        ctx.font = `${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = COLORS.label;
        ctx.fillText(label, node.x, node.y + r + 2 / globalScale);
      }}
      linkColor={(l: LinkObj) => (linkHovered(l) ? COLORS.hover : COLORS.link)}
      linkWidth={(l: LinkObj) =>
        (linkHovered(l) ? 2 : 1) * display.linkThickness
      }
      onNodeHover={(node: NodeObj | null) => {
        hoverRef.current =
          node && node.id != null
            ? {
                id: String(node.id),
                neighbors: neighbors.get(String(node.id)) ?? new Set(),
              }
            : null;
      }}
      onNodeClick={(node: NodeObj) => {
        if (node.type === "note") onNodeClick(String(node.id));
      }}
      onRenderFramePost={(
        ctx: CanvasRenderingContext2D,
        globalScale: number,
      ) => {
        const t = pulseProgress(stateRef.current, performance.now());
        if (t === null) return;
        // searching pulse: ring expanding from the graph origin, fading out
        ctx.beginPath();
        ctx.arc(0, 0, t * 600, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(126, 249, 255, ${1 - t})`;
        ctx.lineWidth = 3 / globalScale;
        ctx.stroke();
      }}
    />
  );
}
