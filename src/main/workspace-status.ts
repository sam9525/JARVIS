import type {
  StatusEvent,
  StatusKind,
  ToolEvent,
  WorkspaceStatus,
} from "../shared/types";

// Stop does not fire when the user hits Esc, so a workspace could sit reading
// "running" forever. Staleness closes that gap.
export const STALE_MS = 60000;

// an inbox row from a project last touched days ago should not sit forever:
// 6h of wall-clock idleness with no live terminal and the whole row goes
export const EXPIRE_MS = 6 * 60 * 60 * 1000;

interface Entry {
  kind: StatusKind;
  call: string;
  message: string;
  delegatedBy: string;
  since: number;
  lastEventAt: number;
  sessionId: string;
  reads: Set<string>;
  edits: Set<string>;
  ptyAlive: boolean;
}

export interface StatusStore {
  restore(saved: unknown): void;
  applyStatus(e: StatusEvent): boolean;
  countTool(e: ToolEvent): boolean;
  markDelegated(workspaceId: string, by: string, now: number): boolean;
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
        message: "",
        delegatedBy: "",
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
    // Closing the app must not lose the last thing Claude said. Only the
    // message is worth keeping: a restored workspace has no live terminal, so
    // it reads idle with no counts until a session actually starts.
    restore(saved) {
      if (!Array.isArray(saved)) return;
      for (const raw of saved as Partial<WorkspaceStatus>[]) {
        if (typeof raw?.workspaceId !== "string") continue;
        if (typeof raw.message !== "string" || !raw.message) continue;
        const since = typeof raw.since === "number" ? raw.since : Date.now();
        const e = entry(raw.workspaceId, since);
        e.kind = "idle";
        e.message = raw.message;
        e.since = since;
      }
    },

    applyStatus(ev) {
      const e = entry(ev.workspaceId, ev.ts);
      // A new session's inbox starts empty — but only work takes a workspace
      // over. Claude's ~60s idle Notification, and every event from a second
      // `claude` in the same folder (a CLI window resolves to the same
      // workspace as the app's own terminal), arrive under an unfamiliar id
      // and must not blank the last message. Work announces itself first:
      // UserPromptSubmit, then tools.
      const sessionChanged =
        ev.sessionId !== e.sessionId && ev.kind === "running";
      // an entry that has never seen a session adopts whichever id speaks
      // first, so that session's own later events don't read as a takeover
      if (sessionChanged || !e.sessionId) e.sessionId = ev.sessionId;
      if (sessionChanged) {
        resetCounts(e);
        e.message = "";
        e.delegatedBy = ""; // provenance shares the message's lifecycle
      }
      // a permission prompt carries no call of its own; the pending PreToolUse
      // call is exactly what the user needs to see, so keep it
      const call = ev.call || e.call;
      // only Stop carries a message; keep the prior one otherwise so a running
      // turn still remembers the last thing Claude said
      const message = ev.message ?? e.message;
      const changed =
        sessionChanged ||
        e.kind !== ev.kind ||
        e.call !== call ||
        e.message !== message ||
        !e.ptyAlive; // liveness is in the snapshot, so its first flip is a change
      if (e.kind !== ev.kind) e.since = ev.ts;
      e.kind = ev.kind;
      e.call = call;
      e.message = message;
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

    // set by orchestrate.send just before the prompt is written; the target's
    // own UserPromptSubmit arrives with the SAME session id, so this survives
    // the turn it labels and dies with the session
    markDelegated(id, by, now) {
      const e = entry(id, now);
      const changed = e.delegatedBy !== by;
      e.delegatedBy = by;
      return changed;
    },

    ptyLaunched(id, now) {
      const e = entry(id, now);
      const wasAlive = e.ptyAlive;
      e.ptyAlive = true;
      // a restored row carries the timestamp of the message it was saved with,
      // which can already be older than EXPIRE_MS — opening a terminal must not
      // hand the next sweep a six-hour-stale clock for a session starting now
      e.lastEventAt = now;
      if (e.kind === "none") {
        e.kind = "idle";
        e.since = now;
        return true;
      }
      // a restored row is already idle, so the kind says nothing — but the
      // renderer reads `live` to know a session it never launched is running
      return !wasAlive;
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
      // collect, then delete — never delete mid-iteration
      const expired: string[] = [];
      for (const [id, e] of entries) {
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
        // forgetting, not tombstoning: the next hook event recreates the
        // entry. A live terminal keeps its row no matter how quiet — a card
        // reading "no session" beside an open terminal would be a lie — but
        // it does not keep the message: six hours on, "Claude said" is stale
        // whether or not the terminal it was said in is still open.
        if (now - e.lastEventAt >= EXPIRE_MS) {
          if (!e.ptyAlive) expired.push(id);
          else if (e.message) {
            e.message = "";
            e.delegatedBy = ""; // provenance shares the message's lifecycle
            changed = true;
          }
        }
      }
      for (const id of expired) entries.delete(id);
      return changed || expired.length > 0;
    },

    snapshot() {
      return [...entries.entries()].map(([workspaceId, e]) => ({
        workspaceId,
        kind: e.kind,
        call: e.call,
        message: e.message,
        delegatedBy: e.delegatedBy,
        live: e.ptyAlive,
        since: e.since,
        reads: e.reads.size,
        edits: e.edits.size,
      }));
    },
  };
}
