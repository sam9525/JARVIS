import type { ToolEvent } from "../shared/types";

export const PULSE_MS = 600; // searching pulse ripple duration
export const MATCH_MS = 3000; // matched-files glow lifetime

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
  rev: number; // bumped on every change — 3D polls this to know when to re-bake
}

export function emptyState(): HighlightState {
  return {
    sessionId: null,
    nodes: new Map(),
    trail: [],
    pulseAt: 0,
    matched: new Set(),
    matchAt: 0,
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
    state.rev++;
  } else if (
    e.phase === "post" &&
    (e.tool === "Edit" || e.tool === "Write") &&
    nodeId
  ) {
    state.nodes.set(nodeId, { kind: "modified" }); // sticks all session
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
  if (!state.pulseAt || now < state.pulseAt) return null;
  const t = (now - state.pulseAt) / PULSE_MS;
  return t >= 1 ? null : t;
}

export function matchProgress(
  state: HighlightState,
  now: number,
): number | null {
  if (!state.matchAt || now < state.matchAt) return null;
  const t = (now - state.matchAt) / MATCH_MS;
  return t >= 1 ? null : t;
}

// Expiry is a pure call on the views' existing ticks rather than a timer the
// store owns — nothing to leak, and the whole lifecycle stays synchronously
// testable. Returns true when it actually cleared something.
export function expireMatches(state: HighlightState, now: number): boolean {
  if (!state.matched.size || now - state.matchAt < MATCH_MS) return false;
  state.matched.clear();
  state.matchAt = 0;
  state.rev++;
  return true;
}
