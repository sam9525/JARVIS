import { applyEvent, emptyState, type HighlightState } from "./highlight-store";
import type { ToolEvent } from "../shared/types";

// Graph3D re-bakes only when state.rev differs from the value it last saw, in a
// ref that survives a retarget. A folded state's own bump count could
// coincidentally equal the live store's rev and silently skip that re-bake, so
// both retarget paths stamp from this counter. Starts high to stay clear of any
// rev applyEvent could have reached on its own.
let revSeq = 1e9;

export function nextRev(): number {
  return ++revSeq;
}

// The highlight state as of event `index` (0-based, clamped to the log).
//
// Folded with each event's 1-based index as its clock, not a wall clock:
// applyEvent stamps pulseAt/matchAt only when it produced that effect, so after
// the fold those fields name the responsible event, and frozenAt tells the
// store's guards which transient to hold. 1-based keeps a real stamp distinct
// from the 0 that means "never happened".
export function foldTo(log: ToolEvent[], index: number): HighlightState {
  const s = emptyState();
  if (!log.length) {
    s.frozenAt = -1; // no event stamped anything; -1 can never match a stamp
    s.rev = nextRev();
    return s;
  }
  const last = Math.min(Math.max(index, 0), log.length - 1);
  for (let i = 0; i <= last; i++) applyEvent(s, log[i], i + 1);
  s.frozenAt = last + 1;
  s.rev = nextRev();
  return s;
}

// Appends to the workspace's log, starting a fresh one when the session
// changes — the past a scrubber was showing no longer exists. Returns true when
// it started fresh, so the caller can snap out of replay.
//
// ponytail: uncapped. A ToolEvent is a handful of strings, so a long session
// costs little; make it a ring buffer if one ever shows up in a memory profile.
export function appendEvent(
  logs: Map<string, ToolEvent[]>,
  e: ToolEvent,
): boolean {
  const prev = logs.get(e.workspaceId);
  if (!prev?.length || prev[prev.length - 1].sessionId !== e.sessionId) {
    logs.set(e.workspaceId, [e]);
    return true;
  }
  prev.push(e);
  return false;
}

// Prompt events divide a session into turns — the timeline's chapter ticks.
export function chaptersOf(log: ToolEvent[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < log.length; i++)
    if (log[i].tool === "Prompt") out.push(i);
  return out;
}

// One line describing an event, for the label under the scrubber handle. Main's
// callSignature is not reused: it reads raw hook payloads, not ToolEvent.
export function labelOf(e: ToolEvent): string {
  if (e.tool === "Prompt") return "— your message —";
  if (e.pattern) return `${e.tool} "${e.pattern}"`;
  if (e.nodeIds.length === 1) return `${e.tool} ${e.nodeIds[0]}`;
  if (e.nodeIds.length > 1) return `${e.tool} ${e.nodeIds.length} files`;
  return e.tool;
}
