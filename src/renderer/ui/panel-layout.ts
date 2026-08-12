// All floating-panel geometry, with no DOM and no React — Panel.tsx maps this
// straight onto inline styles. Same split as ring-layout.ts: the maths is
// testable without a browser, and the component stays a shell.

import type { PanelId, PanelMap, PanelState } from "../../shared/types";

export const TITLE_BAR_H = 26;
export const MIN_W = 240;
export const MIN_H = 120;
export const SNAP_PX = 16;
/** the bezel's own inset — panels stop at the frame, not the window edge */
export const BEZEL_INSET = 10;
/** spec §3: panels occupy z 20-40, above the bezel (10) and overlay (15) */
export const Z_BASE = 20;

export type Viewport = { width: number; height: number };

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(v, hi));

/** the spec's §4 defaults, resolved against the current viewport */
export function defaultPanel(id: PanelId, vp: Viewport): PanelState {
  const h = Math.round(vp.height * 0.8);
  if (id === "preview")
    return withDefaults({ x: 92, y: 98, w: Math.round(vp.width * 0.26), h });
  if (id === "terminal") {
    // The terminal is the panel you actually work in, so it opens wide enough
    // for Claude Code's TUI and runs the full height under the bezel line.
    const w = Math.round(vp.width * 0.42);
    return withDefaults({
      x: vp.width - w - 38,
      y: 98,
      w,
      h: vp.height - 98 - BEZEL_INSET,
    });
  }
  return withDefaults({
    x: Math.round(vp.width / 2 - 160),
    y: 120,
    w: 320,
    h: Math.round(vp.height * 0.7),
  });

  function withDefaults(r: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): PanelState {
    return clampToViewport({ ...r, collapsed: false, z: Z_BASE }, vp);
  }
}

/**
 * Keep a panel wholly inside the bezel. Runs on settings load and on every
 * window resize: a panel saved on a 4K monitor is otherwise off-screen and
 * unreachable on a laptop.
 */
export function clampToViewport(p: PanelState, vp: Viewport): PanelState {
  const w = Math.max(MIN_W, Math.min(p.w, vp.width - BEZEL_INSET * 2));
  const h = Math.max(MIN_H, Math.min(p.h, vp.height - BEZEL_INSET * 2));
  // hi can fall below lo on a viewport smaller than the minimums; clamp()
  // resolves that to lo, which parks the panel at the top-left inset
  const x = clamp(p.x, BEZEL_INSET, vp.width - BEZEL_INSET - w);
  const y = clamp(p.y, BEZEL_INSET, vp.height - BEZEL_INSET - h);
  return p.x === x && p.y === y && p.w === w && p.h === h
    ? p
    : { ...p, x, y, w, h };
}

/** magnet to the bezel edges — a tidy layout stays available by choice */
export function snapToEdges(p: PanelState, vp: Viewport): PanelState {
  let { x, y } = p;
  if (Math.abs(x - BEZEL_INSET) <= SNAP_PX) x = BEZEL_INSET;
  const right = vp.width - BEZEL_INSET - p.w;
  if (Math.abs(x - right) <= SNAP_PX) x = right;
  if (Math.abs(y - BEZEL_INSET) <= SNAP_PX) y = BEZEL_INSET;
  const bottom = vp.height - BEZEL_INSET - p.h;
  if (Math.abs(y - bottom) <= SNAP_PX) y = bottom;
  return x === p.x && y === p.y ? p : { ...p, x, y };
}

export function movePanel(
  p: PanelState,
  dx: number,
  dy: number,
  vp: Viewport,
): PanelState {
  return clampToViewport({ ...p, x: p.x + dx, y: p.y + dy }, vp);
}

/** which sides a resize drag moves — the eight compass handles on the border */
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Drag one edge or corner. The opposite side stays put, which for the north and
 * west handles means moving the origin as the size shrinks — so the delta is
 * clamped here rather than left to clampToViewport, which would pin x or y and
 * let the far edge crawl.
 */
export function resizePanel(
  p: PanelState,
  dx: number,
  dy: number,
  vp: Viewport,
  edge: ResizeEdge = "se",
): PanelState {
  const next = { ...p };
  if (edge.includes("e")) next.w = p.w + dx;
  if (edge.includes("s")) next.h = p.h + dy;
  if (edge.includes("w")) {
    const d = clamp(dx, BEZEL_INSET - p.x, p.w - MIN_W);
    next.x = p.x + d;
    next.w = p.w - d;
  }
  if (edge.includes("n")) {
    const d = clamp(dy, BEZEL_INSET - p.y, p.h - MIN_H);
    next.y = p.y + d;
    next.h = p.h - d;
  }
  return clampToViewport(next, vp);
}

export function raise(panels: PanelMap, id: PanelId): PanelMap {
  const target = panels[id];
  if (!target) return panels;
  const top = Math.max(...Object.values(panels).map((p) => p.z));
  const normalised = top === Z_BASE + Object.keys(panels).length - 1;
  if (target.z === top && normalised) return panels;
  // Renormalise rather than `top + 1`: three panels never need more than
  // three z values, and this keeps the whole stack inside the spec's 20-40
  // band forever instead of climbing through the bezel and overlay on every
  // focus change.
  const rest = (Object.keys(panels) as PanelId[])
    .filter((pid) => pid !== id)
    .sort((a, b) => panels[a]!.z - panels[b]!.z);
  const next: PanelMap = {};
  rest.forEach((pid, i) => {
    next[pid] = { ...panels[pid]!, z: Z_BASE + i };
  });
  next[id] = { ...target, z: Z_BASE + rest.length };
  return { ...panels, ...next };
}

/** topmost-first, so an overlap resolves to what the user can actually see */
function ordered(panels: PanelMap): Array<[PanelId, PanelState]> {
  return (Object.entries(panels) as Array<[PanelId, PanelState]>).sort(
    (a, b) => b[1].z - a[1].z,
  );
}

export function titleBarAt(
  panels: PanelMap,
  x: number,
  y: number,
): PanelId | null {
  for (const [id, p] of ordered(panels))
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + TITLE_BAR_H)
      return id;
  return null;
}

export function panelAt(
  panels: PanelMap,
  x: number,
  y: number,
): PanelId | null {
  for (const [id, p] of ordered(panels)) {
    const h = p.collapsed ? TITLE_BAR_H : p.h;
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + h) return id;
  }
  return null;
}

export function clampAll(panels: PanelMap, vp: Viewport): PanelMap {
  const next: PanelMap = {};
  for (const [id, p] of Object.entries(panels) as Array<[PanelId, PanelState]>)
    next[id] = clampToViewport(p, vp);
  return next;
}

/**
 * What a pinch has hold of. `held` is the decision already made on the frame
 * the pinch closed: once latched it survives the hand wandering off the title
 * bar, so a fast drag cannot drop the panel mid-flight. The `snap` that ends
 * every pinch clears it, and the next pinch decides again.
 */
export function grabTarget(
  panels: PanelMap,
  cursor: { x: number; y: number } | null,
  held: PanelId | null | undefined,
): PanelId | null {
  // `undefined` = not decided yet this gesture; `null` = decided, nothing
  // grabbed. Both are sticky: a drag that began over bare ground must keep
  // panning even if it later sweeps across a title bar, or a graph pan would
  // yank whatever panel it passed over.
  if (held !== undefined) return held;
  return cursor ? titleBarAt(panels, cursor.x, cursor.y) : null;
}
