import React, { useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { GraphGroup, ViewSettings, VaultGraph } from "../../shared/types";
import {
  expireMatches,
  heatOf,
  hlKey,
  matchProgress,
  nodeDisplay,
  pulseProgress,
  type HighlightState,
} from "../session/highlight-store";
import { colorFor, groupColor } from "./domain-colors";
import { displayRadius, graphMetrics } from "./graph-metrics";
import { brighten, COLORS } from "./graph-colors";
import { useForceTuning, type ForceHandle } from "./use-force-tuning";
import { nodeLabelText } from "./node-label";
import { endId, type LinkObj, type NodeObj } from "./link-ends";

const ZOOM = { min: 0.5, thumbnail: 0.01, max: 15 } as const;

export type GraphHandle = {
  pan(dx: number, dy: number): void; // normalized hand units; content follows the hand
  zoom(factor: number): void; // multiplicative; clamped by minZoom/maxZoom
};

// px of pan per normalized hand unit — a hand crossing most of the camera
// frame pans most of the slot. Starting value, tune on a real camera.
export const PAN_PX_PER_UNIT = 900;

type GraphProps = {
  graph: VaultGraph; // may be filtered
  domains: string[]; // from the FULL graph — keeps palette indices stable
  groups: GraphGroup[];
  display: ViewSettings["display"];
  forces: ViewSettings["forces"];
  stateRef: React.MutableRefObject<HighlightState>;
  onNodeClick: (id: string) => void;
  focusNode: string | null; // center this node in the graph slot
  layoutEpoch: number; // bumped by manual refresh — re-arm the one-time fit
  width: number; // measured graph-slot size from GraphSlot's ResizeObserver
  height: number;
  // card mode: no zoom floor (a 220px card fits at ~0.15, far below ZOOM.min),
  // a tight margin, and a refit every tick so the settle stays inside the card
  thumbnail?: boolean;
  handleRef?: React.MutableRefObject<GraphHandle | null>;
};

export default function Graph({
  graph,
  domains,
  groups,
  display,
  forces,
  stateRef,
  onNodeClick,
  focusNode,
  layoutEpoch,
  width,
  height,
  thumbnail = false,
  handleRef,
}: GraphProps) {
  const fitPadding = thumbnail ? 4 : 40;
  // hover lives in a ref, not state: the canvas repaints every frame anyway (autoPauseRedraw=false)
  const hoverRef = useRef<{ id: string; neighbors: Set<string> } | null>(null);
  const fgRef = useRef<ForceGraphMethods>();
  const didFit = useRef(false); // fit-to-screen once, not on every re-settle

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      pan: (dx, dy) => {
        const fg = fgRef.current;
        if (!fg) return;
        const k = fg.zoom();
        const c = fg.centerAt();
        // divide by zoom so a hand unit is screen distance, not graph distance;
        // content follows the hand, so the centre moves the other way
        fg.centerAt(
          c.x - (dx * PAN_PX_PER_UNIT) / k,
          c.y - (dy * PAN_PX_PER_UNIT) / k,
        );
      },
      zoom: (factor) => {
        const fg = fgRef.current;
        if (!fg || factor <= 0) return;
        fg.zoom(fg.zoom() * factor);
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, []);

  // a rescan hands over brand-new node objects, so the simulation restarts
  // on its own; we only need to let onEngineStop re-fit the camera
  useEffect(() => {
    if (layoutEpoch === 0) return;
    didFit.current = false;
  }, [layoutEpoch]);

  // A parked card never runs onRenderFramePost, which is where the open view
  // expires matches and repaints. Poll the store's rev counter instead and
  // refresh on change — the same trick Graph3D uses for its baked-in accessors.
  const lastRev = useRef(-1);
  useEffect(() => {
    if (!thumbnail) return;
    const id = setInterval(() => {
      const s = stateRef.current;
      expireMatches(s, performance.now());
      if (s.rev !== lastRev.current) {
        lastRev.current = s.rev;
        fgRef.current?.refresh();
      }
    }, 250);
    return () => clearInterval(id);
  }, [thumbnail, stateRef]);

  // force-graph mutates node objects (x/y); hand it copies so React state stays clean.
  // Nodes carry the BASE radius only — display.nodeSize applies at paint time,
  // otherwise every slider tick would re-bind data and restart the simulation.
  const { data, neighbors, nodeById } = useMemo(() => {
    const m = graphMetrics(graph);
    const nodes = graph.nodes.map((n) => ({
      ...n,
      r: m.radius.get(n.id) ?? 4,
    }));
    return {
      data: {
        nodes,
        links: graph.edges.map((e) => ({ source: e.source, target: e.target })),
      },
      neighbors: m.neighbors,
      nodeById: new Map(nodes.map((n) => [n.id, n as NodeObj])),
    };
  }, [graph]);

  useForceTuning(
    fgRef as unknown as React.MutableRefObject<ForceHandle | undefined>,
    forces,
  );

  // zoom in on the focused node, centered in the visible area right of the
  // left-docked preview card; closing the preview returns to the launch fit.
  // focusZoom in the deps makes slider drags re-apply live while a note is open.
  const hadFocus = useRef(false);
  useEffect(() => {
    if (!focusNode) {
      if (hadFocus.current) {
        hadFocus.current = false;
        fgRef.current?.zoomToFit(1000, fitPadding);
      }
      return;
    }
    hadFocus.current = true;
    const node = nodeById.get(focusNode);
    if (!node || node.x === undefined || node.y === undefined) return;
    // offset uses the TARGET zoom so the node lands beside the card, not
    // where the old zoom would have put it
    const k = display.focusZoom;
    // preview is a layout sibling now, so the slot already excludes it —
    // center the node in the slot with no horizontal offset
    fgRef.current?.centerAt(node.x, node.y, 1200);
    fgRef.current?.zoom(k, 1200);
  }, [focusNode, nodeById, display.focusZoom]);

  const linkHovered = (l: LinkObj) => {
    const h = hoverRef.current;
    return h !== null && (endId(l.source) === h.id || endId(l.target) === h.id);
  };

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={data}
      width={width}
      height={height}
      backgroundColor={COLORS.bg}
      // the open view repaints so flares fade, pulses ripple and hover tracks;
      // a card has none of those, so let it park and nudge it from the effect below
      autoPauseRedraw={thumbnail}
      nodeRelSize={1}
      minZoom={thumbnail ? ZOOM.thumbnail : ZOOM.min}
      maxZoom={ZOOM.max}
      cooldownTicks={200} // settle in ~1-2s instead of the default 15s so the fit fires promptly
      // a card is too small to let the settle spill past its edges, so it
      // reframes as it goes; the full view fits once, at the end
      onEngineTick={
        thumbnail ? () => fgRef.current?.zoomToFit(0, fitPadding) : undefined
      }
      onEngineStop={() => {
        if (didFit.current) return;
        didFit.current = true;
        fgRef.current?.zoomToFit(200, fitPadding);
      }}
      nodeLabel="id"
      nodeVal={(node: NodeObj) =>
        displayRadius(
          node.r ?? 4,
          display.nodeSize,
          heatOf(stateRef.current, hlKey(node)),
        ) ** 2
      }
      nodeCanvasObject={(
        node: NodeObj,
        ctx: CanvasRenderingContext2D,
        globalScale: number,
      ) => {
        if (node.x === undefined || node.y === undefined) return;
        const id = String(node.id);
        const hk = hlKey(node);
        const t = heatOf(stateRef.current, hk);
        const r = displayRadius(node.r ?? 4, display.nodeSize, t);
        const d = nodeDisplay(stateRef.current, hk);
        const base =
          node.type === "tag" ? COLORS.tag : colorFor(node.domain, domains);
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        // modified wins, then group color, then domain palette; reads keep
        // their base color and get a ring instead. heat brightens whichever won.
        ctx.fillStyle = brighten(
          d === "modified" ? COLORS.modified : (groupColor(id, groups) ?? base),
          t,
        );
        ctx.fill();

        if (d === "ring") {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 2.5 / globalScale, 0, 2 * Math.PI);
          ctx.strokeStyle = COLORS.ring;
          ctx.lineWidth = 1.5 / globalScale;
          ctx.stroke();
        }

        // the node whose preview is open
        if (id === focusNode) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 3 / globalScale, 0, 2 * Math.PI);
          ctx.strokeStyle = COLORS.hover;
          ctx.lineWidth = 2 / globalScale;
          ctx.stroke();
        }

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
        if (t !== null) {
          // searching pulse: ring expanding from the graph origin, fading out
          ctx.beginPath();
          ctx.arc(0, 0, t * 600, 0, 2 * Math.PI);
          ctx.strokeStyle = `rgba(126, 249, 255, ${1 - t})`;
          ctx.lineWidth = 3 / globalScale;
          ctx.stroke();
        }

        // matched files: a soft ring that fades over MATCH_MS. Drawn here
        // rather than in nodeCanvasObject so the alpha is a per-frame value
        // instead of something baked into each node.
        const mt = matchProgress(stateRef.current, performance.now());
        if (mt !== null) {
          ctx.strokeStyle = COLORS.match;
          ctx.globalAlpha = 1 - mt;
          ctx.lineWidth = 2 / globalScale;
          for (const n of data.nodes) {
            if (!stateRef.current.matched.has(hlKey(n))) continue;
            // filtered-out nodes have no live position — skip
            if (n.x === undefined || n.y === undefined) continue;
            // heat included: a hot node is drawn larger, and a ring sized off
            // the cold radius would be painted over by the node itself
            const r = displayRadius(
              n.r ?? 4,
              display.nodeSize,
              heatOf(stateRef.current, hlKey(n)),
            );
            ctx.beginPath();
            ctx.arc(n.x, n.y, r + 4 / globalScale, 0, 2 * Math.PI);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        } else {
          expireMatches(stateRef.current, performance.now());
        }

        // ponytail: trail entries are file-path ids; in symbol mode no symbol node
        // carries that id, so trail arrows simply don't resolve here. Structure-first.
        // read-order trail: arrows between consecutively read nodes
        const trail = stateRef.current.trail;
        if (trail.length < 2) return;
        ctx.strokeStyle = `${COLORS.trail}99`; // 99 hex = 60% alpha
        ctx.fillStyle = `${COLORS.trail}99`;
        ctx.lineWidth = 1.5 / globalScale;
        for (let i = 0; i < trail.length - 1; i++) {
          const a = nodeById.get(trail[i]);
          const b = nodeById.get(trail[i + 1]);
          // filtered-out nodes have no live position — skip the hop
          if (!a || !b || a.x === undefined || b.x === undefined) continue;
          const dx = (b.x ?? 0) - (a.x ?? 0);
          const dy = (b.y ?? 0) - (a.y ?? 0);
          const len = Math.hypot(dx, dy);
          // heat included: trail nodes are read nodes, so they are exactly the
          // ones that grow — offsets off the cold radius start inside the node
          const ra = displayRadius(
            a.r ?? 4,
            display.nodeSize,
            heatOf(stateRef.current, trail[i]),
          );
          const rb = displayRadius(
            b.r ?? 4,
            display.nodeSize,
            heatOf(stateRef.current, trail[i + 1]),
          );
          if (len < ra + rb + 2) continue; // nodes touching — no room
          const ux = dx / len;
          const uy = dy / len;
          const sx = (a.x ?? 0) + ux * (ra + 1);
          const sy = (a.y ?? 0) + uy * (ra + 1);
          const ex = (b.x ?? 0) - ux * (rb + 1);
          const ey = (b.y ?? 0) - uy * (rb + 1);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          // arrowhead at the target end
          const h = 6 / globalScale;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - ux * h - uy * (h / 2), ey - uy * h + ux * (h / 2));
          ctx.lineTo(ex - ux * h + uy * (h / 2), ey - uy * h - ux * (h / 2));
          ctx.closePath();
          ctx.fill();
        }
      }}
    />
  );
}
