import type { ToolEvent } from "../shared/types";

export const FLARE_MS = 2000; // Read flare: bright this long, then dim tint
export const PULSE_MS = 600; // searching pulse ripple duration

type Highlight = { kind: "read"; at: number } | { kind: "modified" };

export interface HighlightState {
  sessionId: string | null;
  nodes: Map<string, Highlight>;
  pulseAt: number; // 0 = no pulse
}

export function emptyState(): HighlightState {
  return { sessionId: null, nodes: new Map(), pulseAt: 0 };
}

export function applyEvent(
  state: HighlightState,
  e: ToolEvent,
  now: number,
): void {
  if (state.sessionId !== e.sessionId) {
    // reset on new session (spec highlight lifecycle)
    state.sessionId = e.sessionId;
    state.nodes.clear();
    state.pulseAt = 0;
  }
  const nodeId = e.nodeIds[0];
  if (e.phase === "pre" && (e.tool === "Grep" || e.tool === "Glob")) {
    state.pulseAt = now;
  } else if (e.phase === "pre" && e.tool === "Read" && nodeId) {
    // modified is stronger than read — never downgrade
    if (state.nodes.get(nodeId)?.kind !== "modified") {
      state.nodes.set(nodeId, { kind: "read", at: now });
    }
  } else if (
    e.phase === "post" &&
    (e.tool === "Edit" || e.tool === "Write") &&
    nodeId
  ) {
    state.nodes.set(nodeId, { kind: "modified" }); // sticks all session
  }
}

export type NodeDisplay = "modified" | "read-bright" | "read-dim" | null;

export function nodeDisplay(
  state: HighlightState,
  nodeId: string,
  now: number,
): NodeDisplay {
  const h = state.nodes.get(nodeId);
  if (!h) return null;
  if (h.kind === "modified") return "modified";
  if (now - h.at < 0) return null;
  return now - h.at < FLARE_MS ? "read-bright" : "read-dim";
}

export function pulseProgress(
  state: HighlightState,
  now: number,
): number | null {
  if (!state.pulseAt || now < state.pulseAt) return null;
  const t = (now - state.pulseAt) / PULSE_MS;
  return t >= 1 ? null : t;
}
