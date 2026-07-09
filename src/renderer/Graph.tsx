import React, { useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { VaultGraph } from "../shared/types";
import {
  nodeDisplay,
  pulseProgress,
  type HighlightState,
} from "./highlight-store";
import { colorFor } from "./domain-colors";
import { graphMetrics } from "./graph-metrics";

const COLORS = {
  bg: "#0d1017",
  tag: "#2f3a4d",
  link: "#232a38",
  label: "#8b93a7",
  hover: "#7ef9ff",
  "read-bright": "#7ef9ff",
  "read-dim": "#2b6a70",
  modified: "#ff8c42",
} as const;

const LABEL_MIN_SCREEN_R = 10; // hide labels when node draws smaller than this (screen px)

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
  graph: VaultGraph; // may be section-filtered
  domains: string[]; // from the FULL graph — keeps palette indices stable
  domainColors: Record<string, string>;
  stateRef: React.MutableRefObject<HighlightState>;
  onNodeClick: (id: string) => void;
};

export default function Graph({
  graph,
  domains,
  domainColors,
  stateRef,
  onNodeClick,
}: GraphProps) {
  // hover lives in a ref, not state: the canvas repaints every frame anyway (autoPauseRedraw=false)
  const hoverRef = useRef<{ id: string; neighbors: Set<string> } | null>(null);

  // force-graph mutates node objects (x/y); hand it copies so React state stays clean
  const { data, neighbors } = useMemo(() => {
    const m = graphMetrics(graph);
    return {
      data: {
        nodes: graph.nodes.map((n) => {
          const r = m.radius.get(n.id) ?? 4;
          return { ...n, r, val: r * r }; // nodeRelSize=1 → hit radius = sqrt(val) = r
        }),
        links: graph.edges.map((e) => ({ source: e.source, target: e.target })),
      },
      neighbors: m.neighbors,
    };
  }, [graph]);

  const linkHovered = (l: LinkObj) => {
    const h = hoverRef.current;
    return h !== null && (endId(l.source) === h.id || endId(l.target) === h.id);
  };

  return (
    <ForceGraph2D
      graphData={data}
      backgroundColor={COLORS.bg}
      autoPauseRedraw={false} // keep repainting so flares fade, pulses ripple, hover tracks
      nodeRelSize={1}
      nodeLabel="id"
      nodeCanvasObject={(
        node: NodeObj,
        ctx: CanvasRenderingContext2D,
        globalScale: number,
      ) => {
        if (node.x === undefined || node.y === undefined) return;
        const id = String(node.id);
        const r = node.r ?? 4;
        const d = nodeDisplay(stateRef.current, id, performance.now());
        const base =
          node.type === "tag"
            ? COLORS.tag
            : colorFor(node.domain, domains, domainColors);
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = d ? COLORS[d] : base; // highlights always win
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
        if (r * globalScale < LABEL_MIN_SCREEN_R && !inHover) return;
        const label =
          node.type === "tag"
            ? id.replace(/^tag:/, "#")
            : id.split("/").pop() || id;
        const fontSize = 12 / globalScale;
        ctx.font = `${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = COLORS.label;
        ctx.fillText(label, node.x, node.y + r + 2 / globalScale);
      }}
      linkColor={(l: LinkObj) => (linkHovered(l) ? COLORS.hover : COLORS.link)}
      linkWidth={(l: LinkObj) => (linkHovered(l) ? 2 : 1)}
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
