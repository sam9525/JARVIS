import { MAIN_LABEL, parseSessionKey } from "../shared/session-key";
import type {
  SessionStatus,
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
  workspaceId: string;
  label: string;
  worktree: boolean;
  kind: StatusKind;
  call: string;
  message: string;
  messageAt: number;
  delegatedBy: string;
  delegatedAt: number;
  since: number;
  lastEventAt: number;
  sessionId: string;
  reads: Set<string>;
  edits: Set<string>;
  ptyAlive: boolean;
  // a pty this app spawned. Narrower than ptyAlive, which any hook event
  // sets — a `claude` run by hand in the same folder resolves to the same
  // workspace, and the terminal panel must not read that as its own session.
  ptyOwned: boolean;
}

export interface StatusStore {
  restore(saved: unknown): void;
  applyStatus(e: StatusEvent): boolean;
  countTool(e: ToolEvent): boolean;
  markDelegated(key: string, by: string, now: number): boolean;
  ptyLaunched(key: string, now: number): boolean;
  sessionOpened(key: string, worktree: boolean, now: number): boolean;
  ptyExited(key: string, now: number, exitCode: number): boolean;
  sweep(now: number): boolean;
  snapshot(): WorkspaceStatus[];
  sessionId(key: string): string;
}

// asking and blocked share a rank: both wait on the user
const URGENCY: Record<StatusKind, number> = {
  asking: 0,
  blocked: 0,
  working: 1,
  crashed: 2,
  idle: 3,
  none: 4,
};

const bySessionOrder = (a: Entry, b: Entry): number =>
  a.label === b.label
    ? 0
    : a.label === MAIN_LABEL
      ? -1
      : b.label === MAIN_LABEL
        ? 1
        : a.label < b.label
          ? -1
          : 1;

export function createStatusStore(
  workspaceIds: () => Iterable<string> = () => [],
): StatusStore {
  const entries = new Map<string, Entry>();

  // An entry records its own workspace id and label: from the caller's owner
  // when it has one (an event names its workspace), else parsed from the key
  // against the live workspace list, since a workspace id may hold a `#`. A
  // given owner also corrects an entry first made from a bare key.
  const entry = (
    key: string,
    now: number,
    owner?: { workspaceId: string; label: string },
  ): Entry => {
    let e = entries.get(key);
    if (!e) {
      const { workspaceId, label } =
        owner ?? parseSessionKey(key, workspaceIds());
      e = {
        workspaceId,
        label,
        worktree: false,
        kind: "none",
        call: "",
        message: "",
        messageAt: 0,
        delegatedBy: "",
        delegatedAt: 0,
        since: now,
        lastEventAt: now,
        sessionId: "",
        reads: new Set(),
        edits: new Set(),
        ptyAlive: false,
        ptyOwned: false,
      };
      entries.set(key, e);
    }
    if (owner) {
      e.workspaceId = owner.workspaceId;
      e.label = owner.label;
    }
    return e;
  };

  const ownerOf = (ev: {
    workspaceId: string;
    sessionKey: string;
  }): { workspaceId: string; label: string } => ({
    workspaceId: ev.workspaceId,
    label: parseSessionKey(ev.sessionKey, [ev.workspaceId]).label,
  });

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
        const e = entry(raw.workspaceId, since, {
          workspaceId: raw.workspaceId,
          label: MAIN_LABEL,
        });
        e.kind = "idle";
        e.message = raw.message;
        e.messageAt = since;
        e.since = since;
      }
    },

    applyStatus(ev) {
      const e = entry(ev.sessionKey, ev.ts, ownerOf(ev));
      // A new session's inbox starts empty — but only work takes a workspace
      // over. Claude's ~60s idle Notification, and every event from a second
      // `claude` in the same folder (a CLI window resolves to the same
      // workspace as the app's own terminal), arrive under an unfamiliar id
      // and must not blank the last message. Work announces itself first:
      // UserPromptSubmit, then tools.
      const sessionChanged =
        ev.sessionId !== e.sessionId && ev.kind === "working";
      // an entry that has never seen a session adopts whichever id speaks
      // first, so that session's own later events don't read as a takeover
      if (sessionChanged || !e.sessionId) e.sessionId = ev.sessionId;
      if (sessionChanged) {
        resetCounts(e);
        e.message = "";
        // provenance shares the message's lifecycle, except for a mark made
        // after the old session's last event: a fresh send's /clear opens a
        // new session id, and that mark labels the turn the new id starts
        if (e.delegatedAt < e.lastEventAt) e.delegatedBy = "";
      }
      // a permission prompt carries no call of its own; the pending PreToolUse
      // call is exactly what the user needs to see, so keep it
      const call = ev.call || e.call;
      // only Stop carries a message; keep the prior one otherwise so a running
      // turn still remembers the last thing Claude said
      const message = ev.message ?? e.message;
      const messageAt = ev.message === undefined ? e.messageAt : ev.ts;
      const changed =
        sessionChanged ||
        e.kind !== ev.kind ||
        e.call !== call ||
        e.message !== message ||
        e.messageAt !== messageAt;
      if (e.kind !== ev.kind) e.since = ev.ts;
      e.kind = ev.kind;
      e.call = call;
      e.message = message;
      e.messageAt = messageAt;
      e.lastEventAt = ev.ts;
      e.ptyAlive = true; // events only arrive from a live session
      return changed;
    },

    countTool(ev) {
      const e = entry(ev.sessionKey, ev.ts, ownerOf(ev));
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

    // set by orchestrate.send once the prompt is in the PTY. It survives the
    // turn it labels, whether that turn's UserPromptSubmit arrives under the
    // same session id or the new one /clear opened, and dies with the session
    // after that
    markDelegated(id, by, now) {
      const e = entry(id, now);
      const changed = e.delegatedBy !== by;
      e.delegatedBy = by;
      e.delegatedAt = now;
      return changed;
    },

    ptyLaunched(id, now) {
      const e = entry(id, now);
      const wasOwned = e.ptyOwned;
      e.ptyAlive = true;
      e.ptyOwned = true;
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
      return !wasOwned;
    },

    sessionOpened(key, worktree, now) {
      const e = entry(key, now);
      const changed = e.worktree !== worktree;
      e.worktree = worktree;
      return changed;
    },

    // A clean exit is what closing a terminal looks like, so it reads as no
    // session. A non-zero exit is a different fact and gets its own word —
    // and keeps the message, because what Claude last said still matters
    // when the session dies.
    ptyExited(id, now, exitCode) {
      const e = entries.get(id);
      if (!e) return false;
      const wasOwned = e.ptyOwned;
      e.ptyOwned = false;
      if (e.kind === "none") return wasOwned;
      e.ptyAlive = false;
      e.kind = exitCode === 0 ? "none" : "crashed";
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
          e.kind === "working" &&
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
      const byWorkspace = new Map<string, [string, Entry][]>();
      for (const pair of entries) {
        const group = byWorkspace.get(pair[1].workspaceId) ?? [];
        group.push(pair);
        byWorkspace.set(pair[1].workspaceId, group);
      }
      return [...byWorkspace].map(([workspaceId, group]) => {
        group.sort((x, y) => bySessionOrder(x[1], y[1]));
        const all = group.map(([, e]) => e);
        // the sort is stable, so ties keep the main-first order
        const urgent = all.reduce((best, e) =>
          URGENCY[e.kind] < URGENCY[best.kind] ? e : best,
        );
        const latest = all.reduce((best, e) =>
          e.messageAt > best.messageAt ? e : best,
        );
        const sessions: SessionStatus[] = group.map(([key, e]) => ({
          key,
          label: e.label,
          kind: e.kind,
          live: e.ptyOwned,
          call: e.call,
          since: e.since,
          worktree: e.worktree,
        }));
        return {
          workspaceId,
          kind: urgent.kind,
          call: urgent.call,
          message: latest.message,
          messageAt: latest.messageAt,
          delegatedBy: urgent.delegatedBy,
          live: all.some((e) => e.ptyOwned),
          since: urgent.since,
          reads: all.reduce((n, e) => n + e.reads.size, 0),
          edits: all.reduce((n, e) => n + e.edits.size, 0),
          sessions,
        };
      });
    },

    // "" until a hook has spoken for this session
    sessionId(id) {
      return entries.get(id)?.sessionId ?? "";
    },
  };
}
