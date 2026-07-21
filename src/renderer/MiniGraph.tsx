import React, { useEffect, useRef } from "react";
import type { VaultGraph } from "../shared/types";
import {
  matchProgress,
  nodeDisplay,
  pulseProgress,
  type HighlightState,
} from "./highlight-store";
import { layoutFor } from "./mini-layout";
import { COLORS } from "./graph-colors";

type MiniGraphProps = {
  graph: VaultGraph | null; // null while the workspace's graph is still loading
  state: HighlightState;
  width: number;
  height: number;
};

// A card's thumbnail: the layout is settled once and frozen, and only the
// highlight layer moves. An idle card costs one comparison per frame.
export default function MiniGraph({
  graph,
  state,
  width,
  height,
}: MiniGraphProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lastRev = useRef(-1);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return; // no canvas (jsdom, or a lost context) — render nothing
    lastRev.current = -1; // force one paint after any prop change

    const draw = (c: CanvasRenderingContext2D, now: number) => {
      c.fillStyle = COLORS.bg;
      c.fillRect(0, 0, width, height);
      if (!graph || graph.nodes.length === 0) return;
      const layout = layoutFor(graph, width, height);

      c.strokeStyle = COLORS.link;
      c.lineWidth = 1;
      for (const [a, b] of layout.edges) {
        c.beginPath();
        c.moveTo(layout.nodes[a].x, layout.nodes[a].y);
        c.lineTo(layout.nodes[b].x, layout.nodes[b].y);
        c.stroke();
      }

      for (const n of layout.nodes) {
        const d = nodeDisplay(state, n.id);
        c.beginPath();
        c.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        c.fillStyle = d === "modified" ? COLORS.modified : COLORS.tag;
        c.fill();
        if (d === "ring") {
          c.beginPath();
          c.arc(n.x, n.y, n.r + 2, 0, Math.PI * 2);
          c.strokeStyle = COLORS.ring;
          c.lineWidth = 1;
          c.stroke();
        }
      }

      const mt = matchProgress(state, now);
      if (mt !== null) {
        c.strokeStyle = COLORS.match;
        c.globalAlpha = 1 - mt;
        c.lineWidth = 1.2;
        for (const n of layout.nodes) {
          if (!state.matched.has(n.id)) continue;
          c.beginPath();
          c.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
          c.stroke();
        }
        c.globalAlpha = 1;
      }

      const pt = pulseProgress(state, now);
      if (pt !== null) {
        c.beginPath();
        c.arc(
          width / 2,
          height / 2,
          pt * Math.max(width, height),
          0,
          Math.PI * 2,
        );
        c.strokeStyle = COLORS.ring;
        c.globalAlpha = 1 - pt;
        c.lineWidth = 1;
        c.stroke();
        c.globalAlpha = 1;
      }
    };

    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const live =
        matchProgress(state, now) !== null ||
        pulseProgress(state, now) !== null;
      // repaint every frame only while something is actually animating;
      // otherwise only when the store says it changed
      if (!live && state.rev === lastRev.current) return;
      lastRev.current = state.rev;
      draw(ctx, now);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [graph, state, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className="block w-full rounded"
      style={{ height }}
    />
  );
}
