import React, { useEffect, useMemo, useRef } from "react";
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
import { forceCollide, forceX, forceY } from "d3-force-3d";

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

const ZOOM = { min: 0.3, max: 8 } as const;
const COLLIDE_PADDING = 6; // min gap between any two nodes, linked or not

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

// minimal structural types for the d3 forces we tune
type LinkStrengthFn = (l: unknown) => number;
type LinkForce = {
  distance: (d: number) => LinkForce;
  strength: ((fn: LinkStrengthFn) => LinkForce) & (() => LinkStrengthFn);
};
type StrengthForce = { strength: (v: number) => StrengthForce };

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
  // d3's default link strength is per-link (1/min(degree)); capture it once so
  // the Link force slider multiplies it instead of flattening it to a constant
  const baseLinkStrength = useRef<LinkStrengthFn | null>(null);

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

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge") as StrengthForce | undefined;
    const link = fg.d3Force("link") as LinkForce | undefined;
    const center = fg.d3Force("center") as StrengthForce | undefined;
    if (!charge || !link || !center) return;
    if (!baseLinkStrength.current) baseLinkStrength.current = link.strength();
    const base = baseLinkStrength.current;
    charge.strength(-forces.repelStrength);
    link
      .distance(forces.linkDistance)
      .strength((l) => base(l) * forces.linkStrength);
    center.strength(forces.centerStrength);
    fg.d3Force(
      "collide",
      forceCollide<NodeObj>((n) => (n.r ?? 4) + COLLIDE_PADDING),
    );
    // ponytail: gravity toward origin rounds the layout into a blob; scale with
    // centerStrength so the slider still controls compactness. 0.05 is the knob.
    fg.d3Force("x", forceX(0).strength(forces.centerStrength * 0.05));
    fg.d3Force("y", forceY(0).strength(forces.centerStrength * 0.05));
    fg.d3ReheatSimulation(); // visible re-settle while dragging a force slider
  }, [forces]);

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
