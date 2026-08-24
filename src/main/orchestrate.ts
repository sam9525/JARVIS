import type {
  StatusKind,
  Workspace,
  WorkspaceKind,
  WorkspaceStatus,
} from "../shared/types";

// The orchestrator feature's logic, pure over injected deps — no HTTP, no
// Electron. http-listener exposes it on /orchestrate/*; index.ts wires the
// real workspaces/status/pty in.
export interface OrchestrateDeps {
  getWorkspaces: () => Workspace[];
  snapshot: () => WorkspaceStatus[];
  hasPty: (workspaceId: string) => boolean;
  write: (workspaceId: string, data: string) => boolean;
  markDelegated: (workspaceId: string, by: string) => void;
  // false = no renderer listening; say() reports that rather than going silent
  say: (text: string) => boolean;
}

// one jarvis_list row per workspace
export interface FleetEntry {
  name: string;
  kind: WorkspaceKind;
  status: StatusKind;
  call: string;
  message: string;
  live: boolean;
  delegatedBy: string;
}

export type SendResult = { ok: true } | { ok: false; error: string };

/** Only a summary is spoken, and this cap is what enforces that: a whole
 * project output pasted in is rejected with an error naming the number. */
export const MAX_SAY = 500;
export const WATCH_DEFAULT_S = 60;
export const WATCH_MAX_S = 300;
/** A watcher that has been away long enough to bank 50 finishes is not
 * watching. Past the cap the oldest goes. */
export const QUEUE_MAX = 50;

export type WatchResult =
  { workspace: string; message: string } | { timeout: true };

type Finish = { workspace: string; message: string };

export function createOrchestrator(deps: OrchestrateDeps) {
  // A Claude Code session cannot act on its own, so jarvis_watch parks until a
  // delegate finishes. One shared queue is correct because the topology
  // guarantees one watcher: mcp-install writes .mcp.json into the isSelf
  // workspace only. No cursor to thread, no per-caller state.
  const queue: Finish[] = [];
  let waiter: ((f: Finish) => void) | null = null;

  return {
    list(): FleetEntry[] {
      const byId = new Map(deps.snapshot().map((s) => [s.workspaceId, s]));
      return deps.getWorkspaces().map((w) => {
        const s = byId.get(w.id);
        return {
          name: w.name,
          kind: w.kind,
          status: s?.kind ?? "none",
          call: s?.call ?? "",
          message: s?.message ?? "",
          live: deps.hasPty(w.id),
          delegatedBy: s?.delegatedBy ?? "",
        };
      });
    },

    send(target: string, prompt: string): SendResult {
      const all = deps.getWorkspaces();
      const q = String(target ?? "")
        .trim()
        .toLowerCase();
      const ws = all.find((w) => w.name.toLowerCase() === q || w.id === q);
      if (!ws) {
        const names = all.map((w) => w.name).join(", ");
        return {
          ok: false,
          error: `no workspace "${target}" — workspaces: ${names}`,
        };
      }
      // self-send is the one loop the one-orchestrator topology can't rule out
      if (ws.isSelf) {
        return {
          ok: false,
          error: `refused: ${ws.name} is the orchestrator itself`,
        };
      }
      if (!String(prompt ?? "").trim()) {
        return { ok: false, error: "empty prompt" };
      }
      if (!deps.hasPty(ws.id)) {
        return {
          ok: false,
          error: `${ws.name} has no session — launch it first`,
        };
      }
      // the caller sends no identity — it can only be the one workspace that
      // has the tools, which mcp-install pins to isSelf
      const by = all.find((w) => w.isSelf)?.name ?? "JARVIS";
      // the session can die between the hasPty probe and the write, so mark the
      // delegation only once the prompt is actually in the PTY
      if (!deps.write(ws.id, prompt)) {
        return {
          ok: false,
          error: `${ws.name}'s session ended before delivery`,
        };
      }
      deps.markDelegated(ws.id, by);
      // Claude Code's TUI treats one arriving chunk as a paste, so a trailing
      // "\r" lands as a newline in the composer instead of submitting. Send the
      // CR as its own write a beat later — indistinguishable from typing Enter.
      // ponytail: fixed 80ms, not a prompt-ready probe — bump if a busy TUI misses it
      // ponytail: send has already returned by the time the CR lands, so a session
      // that dies inside the 80ms leaves the prompt unsubmitted and only surfaces
      // as the delegate going stale in jarvis_list. Await delivery if that bites.
      setTimeout(() => deps.write(ws.id, "\r"), 80);
      return { ok: true };
    },

    publishFinish(workspaceId: string, message: string): void {
      const text = String(message ?? "").trim();
      if (!text) return;
      const ws = deps.getWorkspaces().find((w) => w.id === workspaceId);
      // the orchestrator waking on its own turn ending is a loop with itself
      if (!ws || ws.isSelf) return;
      const finish: Finish = { workspace: ws.name, message: text };
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(finish);
        return;
      }
      queue.push(finish);
      if (queue.length > QUEUE_MAX) queue.shift();
    },

    watch(timeoutSeconds = WATCH_DEFAULT_S): Promise<WatchResult> {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      const secs = Math.min(
        Math.max(Number(timeoutSeconds) || WATCH_DEFAULT_S, 1),
        WATCH_MAX_S,
      );
      return new Promise<WatchResult>((resolve) => {
        const fire = (f: Finish) => {
          clearTimeout(timer);
          resolve(f);
        };
        const timer = setTimeout(() => {
          // drop the parked resolver, or the next finish resolves a promise
          // nobody is holding and the entry is lost
          if (waiter === fire) waiter = null;
          resolve({ timeout: true });
        }, secs * 1000);
        waiter = fire;
      });
    },

    say(text: string): SendResult {
      const t = String(text ?? "").trim();
      if (!t) return { ok: false, error: "empty text" };
      if (t.length > MAX_SAY)
        return {
          ok: false,
          error: `text is ${t.length} characters — the cap is ${MAX_SAY}; speak a summary, not the output`,
        };
      if (!deps.say(t))
        return { ok: false, error: "no JARVIS window is listening" };
      return { ok: true };
    },
  };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
