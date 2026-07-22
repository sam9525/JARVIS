import type {
  StatusEvent,
  StatusKind,
  ToolEvent,
  WorkspaceStatus,
} from "../shared/types";

// Stop does not fire when the user hits Esc, so a workspace could sit reading
// "running" forever. Staleness closes that gap.
export const STALE_MS = 60000;

interface Entry {
  kind: StatusKind;
  call: string;
  since: number;
  lastEventAt: number;
  sessionId: string;
  reads: Set<string>;
  edits: Set<string>;
  ptyAlive: boolean;
}

export interface StatusStore {
  applyStatus(e: StatusEvent): boolean;
  countTool(e: ToolEvent): boolean;
  ptyLaunched(workspaceId: string, now: number): boolean;
  ptyExited(workspaceId: string, now: number): boolean;
  sweep(now: number): boolean;
  snapshot(): WorkspaceStatus[];
}

export function createStatusStore(): StatusStore {
  const entries = new Map<string, Entry>();

  const entry = (id: string, now: number): Entry => {
    let e = entries.get(id);
    if (!e) {
      e = {
        kind: "none",
        call: "",
        since: now,
        lastEventAt: now,
        sessionId: "",
        reads: new Set(),
        edits: new Set(),
        ptyAlive: false,
      };
      entries.set(id, e);
    }
    return e;
  };

  const resetCounts = (e: Entry) => {
    e.reads.clear();
    e.edits.clear();
  };

  return {
    applyStatus(ev) {
      const e = entry(ev.workspaceId, ev.ts);
      const sessionChanged = ev.sessionId !== e.sessionId;
      if (sessionChanged) {
        e.sessionId = ev.sessionId;
        resetCounts(e);
      }
      // a permission prompt carries no call of its own; the pending PreToolUse
      // call is exactly what the user needs to see, so keep it
      const call = ev.call || e.call;
      const changed = sessionChanged || e.kind !== ev.kind || e.call !== call;
      if (e.kind !== ev.kind) e.since = ev.ts;
      e.kind = ev.kind;
      e.call = call;
      e.lastEventAt = ev.ts;
      e.ptyAlive = true; // events only arrive from a live session
      return changed;
    },

    countTool(ev) {
      const e = entry(ev.workspaceId, ev.ts);
      let changed = false;
      // a new session clears the counts but must NOT swallow the event that
      // announced it — that event is itself the session's first activity
      if (ev.sessionId !== e.sessionId) {
        e.sessionId = ev.sessionId;
        resetCounts(e);
        changed = true;
      }
      if (ev.tool === "Prompt") {
        const had = e.reads.size > 0 || e.edits.size > 0;
        resetCounts(e);
        return changed || had;
      }
      const before = e.reads.size + e.edits.size;
      // only an opened file counts as a read — a search match is not a read
      if (ev.phase === "pre" && ev.tool === "Read")
        for (const id of ev.nodeIds) e.reads.add(id);
      if (ev.phase === "post" && (ev.tool === "Edit" || ev.tool === "Write"))
        for (const id of ev.nodeIds) e.edits.add(id);
      return changed || e.reads.size + e.edits.size !== before;
    },

    ptyLaunched(id, now) {
      const e = entry(id, now);
      e.ptyAlive = true;
      if (e.kind === "none") {
        e.kind = "idle";
        e.since = now;
        return true;
      }
      return false;
    },

    ptyExited(id, now) {
      const e = entries.get(id);
      if (!e || e.kind === "none") return false;
      e.ptyAlive = false;
      e.kind = "none";
      e.call = "";
      e.since = now; // types.ts documents since as the last KIND change
      return true;
    },

    sweep(now) {
      let changed = false;
      for (const e of entries.values()) {
        // demote only; staleness must never invent "waiting"
        if (
          e.kind === "running" &&
          e.ptyAlive &&
          now - e.lastEventAt >= STALE_MS
        ) {
          e.kind = "idle";
          e.since = now;
          changed = true;
        }
      }
      return changed;
    },

    snapshot() {
      return [...entries.entries()].map(([workspaceId, e]) => ({
        workspaceId,
        kind: e.kind,
        call: e.call,
        since: e.since,
        reads: e.reads.size,
        edits: e.edits.size,
      }));
    },
  };
}
