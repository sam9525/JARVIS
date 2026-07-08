import React, { useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { VaultGraph } from "../shared/types";
import {
  nodeDisplay,
  pulseProgress,
  type HighlightState,
} from "./highlight-store";
import { colorFor } from "./domain-colors";

const COLORS = {
  bg: "#0d1017",
  tag: "#2f3a4d",
  link: "#232a38",
  label: "#8b93a7",
  "read-bright": "#7ef9ff",
  "read-dim": "#2b6a70",
  modified: "#ff8c42",
} as const;

const NODE_R = 5; // keep in sync with nodeRelSize

type NodeObj = {
  id?: string | number;
  type?: string;
  domain?: string;
  x?: number;
  y?: number;
};

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
  // force-graph mutates node objects (x/y); hand it copies so React state stays clean
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.edges.map((e) => ({ source: e.source, target: e.target })),
    }),
    [graph],
  );

  return (
    <ForceGraph2D
      graphData={data}
      backgroundColor={COLORS.bg}
      autoPauseRedraw={false} // keep repainting so flares fade and pulses ripple
      nodeRelSize={NODE_R}
      nodeLabel="id"
      nodeCanvasObject={(
        node: NodeObj,
        ctx: CanvasRenderingContext2D,
        globalScale: number,
      ) => {
        if (node.x === undefined || node.y === undefined) return;
        const id = String(node.id);
        const d = nodeDisplay(stateRef.current, id, performance.now());
        const base =
          node.type === "tag"
            ? COLORS.tag
            : colorFor(node.domain, domains, domainColors);
        ctx.beginPath();
        ctx.arc(node.x, node.y, NODE_R, 0, 2 * Math.PI);
        ctx.fillStyle = d ? COLORS[d] : base; // highlights always win
        ctx.fill();

        const label =
          node.type === "tag"
            ? id.replace(/^tag:/, "#")
            : id.split("/").pop() || id;
        const fontSize = 12 / globalScale;
        ctx.font = `${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = COLORS.label;
        ctx.fillText(label, node.x, node.y + NODE_R + 2 / globalScale);
      }}
      linkColor={() => COLORS.link}
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
