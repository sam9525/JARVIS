import React, { useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { VaultGraph } from "../shared/types";
import {
  nodeDisplay,
  pulseProgress,
  type HighlightState,
} from "./highlight-store";

const COLORS = {
  bg: "#0d1017",
  note: "#4a5568",
  tag: "#2f3a4d",
  link: "#232a38",
  "read-bright": "#7ef9ff",
  "read-dim": "#2b6a70",
  modified: "#ff8c42",
} as const;

type GraphProps = {
  graph: VaultGraph;
  stateRef: React.MutableRefObject<HighlightState>;
  onNodeClick: (id: string) => void;
};

export default function Graph({ graph, stateRef, onNodeClick }: GraphProps) {
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
      nodeRelSize={5}
      nodeLabel="id"
      nodeColor={(node: { id?: string | number; type?: string }) => {
        const d = nodeDisplay(
          stateRef.current,
          String(node.id),
          performance.now(),
        );
        if (d) return COLORS[d];
        return node.type === "tag" ? COLORS.tag : COLORS.note;
      }}
      linkColor={() => COLORS.link}
      onNodeClick={(node: { id?: string | number; type?: string }) => {
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
