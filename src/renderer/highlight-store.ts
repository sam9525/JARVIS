import type { ToolEvent } from "../shared/types";

export const PULSE_MS = 600; // searching pulse ripple duration
export const MATCH_MS = 3000; // matched-files glow lifetime
export const HEAT_CAP = 6; // deliberate touches at which a node is fully hot
export const FROZEN_PULSE = 0.5; // replay holds the pulse mid-animation — its zero-radius start would draw nothing

type Highlight = { kind: "read" } | { kind: "modified" };

export interface HighlightState {
  sessionId: string | null;
  nodes: Map<string, Highlight>;
  trail: string[]; // node ids in read order; consecutive duplicates skipped
  pulseAt: number; // 0 = no pulse
  // files a search actually hit — transient, and deliberately NOT in `nodes`:
  // the read/modified entries there are permanent for the session, so keeping
  // matches out means no reader of that map needs an expiry check.
  matched: Set<string>;
  matchAt: number; // 0 = no active match batch
  // deliberate touches (Read/Edit/Write) per node this session. Reads and edits
  // only: a broad Grep matching 40 files would flatten the map in one event.
  heat: Map<string, number>;
  rev: number; // bumped on every change — 3D polls this to know when to re-bake
  // Set only on states built by replay's foldTo: the 1-based index being viewed.
  // Absent on live states, so nothing about live behaviour changes. When set,
  // pulseAt/matchAt hold event indices rather than wall-clock stamps.
  frozenAt?: number;
}

export function emptyState(): HighlightState {
  return {
    sessionId: null,
    nodes: new Map(),
    trail: [],
    pulseAt: 0,
    matched: new Set(),
    matchAt: 0,
    heat: new Map(),
    rev: 0,
  };
}

// new question, new session, or the settings ↺ button
export function resetHighlights(state: HighlightState): void {
  state.nodes.clear();
  state.trail = [];
  state.pulseAt = 0;
  state.matched.clear();
  state.matchAt = 0;
  state.heat.clear();
  state.rev++;
}

export function applyEvent(
  state: HighlightState,
  e: ToolEvent,
  now: number,
): void {
  if (state.sessionId !== e.sessionId) {
    state.sessionId = e.sessionId;
    resetHighlights(state);
  }
  if (e.tool === "Prompt") {
    resetHighlights(state);
    return;
  }
  const nodeId = e.nodeIds[0];
  if (e.phase === "pre" && (e.tool === "Grep" || e.tool === "Glob")) {
    state.pulseAt = now;
    state.rev++;
  } else if (e.phase === "pre" && e.tool === "Read" && nodeId) {
    // modified is stronger than read — never downgrade
    if (state.nodes.get(nodeId)?.kind !== "modified") {
      state.nodes.set(nodeId, { kind: "read" });
    }
    if (state.trail[state.trail.length - 1] !== nodeId)
      state.trail.push(nodeId);
    bump(state, nodeId); // every read counts, including the ones trail skips
    state.rev++;
  } else if (
    e.phase === "post" &&
    (e.tool === "Edit" || e.tool === "Write") &&
    nodeId
  ) {
    state.nodes.set(nodeId, { kind: "modified" }); // sticks all session
    bump(state, nodeId);
    state.rev++;
  } else if (
    e.phase === "post" &&
    (e.tool === "Grep" || e.tool === "Glob") &&
    e.nodeIds.length
  ) {
    // a new search replaces the last batch wholesale — searches are serialized
    // by the agent loop, so overlapping fades aren't a case worth carrying
    state.matched = new Set(e.nodeIds);
    state.matchAt = now;
    state.rev++;
  }
}

export type NodeDisplay = "modified" | "ring" | null;

export function nodeDisplay(
  state: HighlightState,
  nodeId: string,
): NodeDisplay {
  const h = state.nodes.get(nodeId);
  if (!h) return null;
  return h.kind === "modified" ? "modified" : "ring";
}

export function pulseProgress(
  state: HighlightState,
  now: number,
): number | null {
  if (!state.pulseAt) return null;
  if (state.frozenAt !== undefined)
    return state.pulseAt === state.frozenAt ? FROZEN_PULSE : null;
  if (now < state.pulseAt) return null;
  const t = (now - state.pulseAt) / PULSE_MS;
  return t >= 1 ? null : t;
}

export function matchProgress(
  state: HighlightState,
  now: number,
): number | null {
  if (!state.matchAt) return null;
  if (state.frozenAt !== undefined)
    return state.matchAt === state.frozenAt ? 0 : null;
  if (now < state.matchAt) return null;
  const t = (now - state.matchAt) / MATCH_MS;
  return t >= 1 ? null : t;
}

// Expiry is a pure call on the views' existing ticks rather than a timer the
// store owns — nothing to leak, and the whole lifecycle stays synchronously
// testable. Returns true when it actually cleared something.
export function expireMatches(state: HighlightState, now: number): boolean {
  if (state.frozenAt !== undefined) return false; // a parked view never decays
  if (!state.matched.size || now - state.matchAt < MATCH_MS) return false;
  state.matched.clear();
  state.matchAt = 0;
  state.rev++;
  return true;
}

function bump(state: HighlightState, nodeId: string): void {
  state.heat.set(nodeId, (state.heat.get(nodeId) ?? 0) + 1);
}

// 0..1, absolute and capped — a node's heat depends only on its own count, so
// nothing repaints because a *different* file got hot.
export function heatOf(state: HighlightState, nodeId: string): number {
  return Math.min(state.heat.get(nodeId) ?? 0, HEAT_CAP) / HEAT_CAP;
}

// The store is keyed by file path. A symbol node resolves its highlight by its
// file, so a file event lights every symbol in that file; file/tag nodes have no
// `file` and fall back to their id — unchanged behavior.
export function hlKey(node: { id?: string | number; file?: string }): string {
  return String(node.file ?? node.id);
}

