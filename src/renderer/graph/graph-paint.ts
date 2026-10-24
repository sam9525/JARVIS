import type { CardLayout, GraphGroup, LayoutNode } from "../../shared/types";
import {
  heatOf,
  hlKey,
  impactDepth,
  isRead,
  matchProgress,
  nodeDisplay,
  pulseProgress,
  type HighlightState,
} from "../session/highlight-store";
import { baseNodeColor } from "./domain-colors";
import { displayRadius } from "./graph-metrics";
import type { NodeObj } from "./link-ends";
import { brighten, COLORS, RADIUS_COLOR, radiusColor } from "./graph-colors";

/**
 * The painter's view of a live node: null until the simulation has placed it.
 * The fill is the colour before highlights, group first, then tag or domain.
 */
export function layoutNodeOf(
  node: NodeObj,
  domains: string[],
  groups: GraphGroup[],
  baseHue: number,
): LayoutNode | null {
  if (node.x === undefined || node.y === undefined) return null;
  const id = String(node.id);
  return {
    id,
    hk: hlKey(node),
    x: node.x,
    y: node.y,
    r: node.r ?? 4,
    fill: baseNodeColor(
      { id, type: node.type, domain: node.domain },
      domains,
      groups,
      baseHue,
    ),
  };
}

type NodePaint = { nodeSize: number; globalScale: number };

/** The disc and its modified, read and impact rings, in graph space. */
export function paintNode(
  ctx: CanvasRenderingContext2D,
  n: LayoutNode,
  state: HighlightState,
  { nodeSize, globalScale }: NodePaint,
): void {
  const t = heatOf(state, n.hk);
  const r = displayRadius(n.r, nodeSize, t);
  const d = nodeDisplay(state, n.hk);
  ctx.beginPath();
  ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
  // reads and edits keep their base colour and get rings instead; heat
  // brightens whichever colour won
  const depth = impactDepth(state, n.hk);
  ctx.fillStyle = brighten(
    depth !== null ? radiusColor(depth, n.fill) : n.fill,
    t,
  );
  ctx.fill();

  const modified = d === "modified";
  if (modified) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, r + 2.5 / globalScale, 0, 2 * Math.PI);
    ctx.strokeStyle = COLORS.modified;
    ctx.lineWidth = 1.5 / globalScale;
    ctx.stroke();
  }
  if (
    d === "ring" ||
    (modified && isRead(state, n.hk)) ||
    (d === "impact" && (depth ?? 2) <= 1)
  ) {
    ctx.beginPath();
    // outside the modified ring when a node wears both
    const gap = modified ? 4.5 : 2.5;
    ctx.arc(n.x, n.y, r + gap / globalScale, 0, 2 * Math.PI);
    ctx.strokeStyle = d === "impact" ? RADIUS_COLOR : COLORS.ring;
    ctx.lineWidth = 1.5 / globalScale;
    ctx.stroke();
  }
}

/**
 * The per-frame layer over the nodes: the search pulse, the fading match
 * rings and the read-order trail. `byId` resolves trail entries, which are
 * node ids; `pulseReach` is the pulse's final radius in graph units.
 */
export function paintOverlay(
  ctx: CanvasRenderingContext2D,
  nodes: LayoutNode[],
  byId: Map<string, LayoutNode>,
  state: HighlightState,
  o: NodePaint & { now: number; pulseReach: number },
): void {
  const { nodeSize, globalScale, now } = o;
  const t = pulseProgress(state, now);
  if (t !== null) {
    // searching pulse: a ring expanding from the graph origin, fading out
    ctx.beginPath();
    ctx.arc(0, 0, t * o.pulseReach, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(126, 249, 255, ${1 - t})`;
    ctx.lineWidth = 3 / globalScale;
    ctx.stroke();
  }

  // matched files: a soft ring that fades over MATCH_MS. The alpha is a
  // per-frame value, so it is drawn here rather than baked into each node.
  const mt = matchProgress(state, now);
  if (mt !== null) {
    ctx.strokeStyle = COLORS.match;
    ctx.globalAlpha = 1 - mt;
    ctx.lineWidth = 2 / globalScale;
    for (const n of nodes) {
      if (!state.matched.has(n.hk)) continue;
      // heat included: a hot node is drawn larger, and a ring sized off the
      // cold radius would be painted over by the node itself
      const r = displayRadius(n.r, nodeSize, heatOf(state, n.hk));
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 4 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ponytail: trail entries are file-path ids; in symbol mode no symbol node
  // carries that id, so trail arrows simply don't resolve here. Structure-first.
  // read-order trail: arrows between consecutively read nodes
  const trail = state.trail;
  if (trail.length < 2) return;
  ctx.strokeStyle = `${COLORS.trail}99`; // 99 hex = 60% alpha
  ctx.fillStyle = `${COLORS.trail}99`;
  ctx.lineWidth = 1.5 / globalScale;
  for (let i = 0; i < trail.length - 1; i++) {
    const a = byId.get(trail[i]);
    const b = byId.get(trail[i + 1]);
    // a node without a position is absent from byId — skip the hop
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // heat included: trail nodes are read nodes, so they are exactly the
    // ones that grow — offsets off the cold radius start inside the node
    const ra = displayRadius(a.r, nodeSize, heatOf(state, trail[i]));
    const rb = displayRadius(b.r, nodeSize, heatOf(state, trail[i + 1]));
    if (len < ra + rb + 2) continue; // nodes touching — no room
    const ux = dx / len;
    const uy = dy / len;
    const sx = a.x + ux * (ra + 1);
    const sy = a.y + uy * (ra + 1);
    const ex = b.x - ux * (rb + 1);
    const ey = b.y - uy * (rb + 1);
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
}

/**
 * A whole stored layout on a plain canvas of `width × height` CSS px at
 * `dpr`: background, links as force-graph strokes them, nodes, then overlay.
 */
export function paintLayout(
  ctx: CanvasRenderingContext2D,
  layout: CardLayout,
  state: HighlightState,
  o: { nodeSize: number; linkThickness: number; dpr: number; now: number },
): void {
  const { width: w, height: h, nodes, links } = layout;
  const { k, x, y } = layout.transform;
  const { dpr } = o;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w * dpr, h * dpr);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  // force-graph's frame: graph point (x, y) at the canvas centre, zoom k
  ctx.setTransform(
    dpr * k,
    0,
    0,
    dpr * k,
    dpr * (w / 2 - k * x),
    dpr * (h / 2 - k * y),
  );

  ctx.strokeStyle = COLORS.link;
  ctx.lineWidth = o.linkThickness / k;
  for (const [s, t] of links) {
    const a = nodes[s];
    const b = nodes[t];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  const paint = { nodeSize: o.nodeSize, globalScale: k };
  const byId = new Map<string, LayoutNode>();
  for (const n of nodes) {
    paintNode(ctx, n, state, paint);
    byId.set(n.id, n);
  }
  paintOverlay(ctx, nodes, byId, state, {
    ...paint,
    now: o.now,
    pulseReach: Math.hypot(w, h) / 2 / k,
  });
}
