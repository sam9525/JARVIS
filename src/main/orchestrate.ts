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
  // the same launch the terminal's button makes; false = spawn failed
  launch: (ws: Workspace) => Promise<boolean>;
  // Claude Code's own record of the folder-trust prompt; null = unreadable
  isTrusted: (ws: Workspace) => Promise<boolean | null>;
  // resolves once the session's TUI has stopped painting (or a deadline passed)
  waitQuiet: (workspaceId: string) => Promise<boolean>;
  markDelegated: (workspaceId: string, by: string) => void;
  // false = no renderer listening; say() reports that rather than going silent
  say: (text: string) => boolean;
  // types the fixed nudge into the main agent's own session, so a finish
  // reaches it without anyone having parked on jarvis_watch first
  nudgeMain: () => void;
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

/** `trustPrompt` is the folder a fresh session is asking the user to trust —
 * a send before jarvis_trust answers it would land on that prompt. */
export type LaunchResult =
  { ok: true; trustPrompt?: string } | { ok: false; error: string };

// the trust prompt opens on "No, exit": Down moves to "Yes", Enter confirms
const TRUST_DOWN = "\x1b[B";
const KEY_GAP_MS = 80;

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

function findWorkspace(all: Workspace[], target: string) {
  const q = String(target ?? "")
    .trim()
    .toLowerCase();
  return all.find((w) => w.name.toLowerCase() === q || w.id === q);
}

function unknownWorkspace(all: Workspace[], target: string): SendResult {
  const names = all.map((w) => w.name).join(", ");
  return {
    ok: false,
    error: `no workspace "${target}" — workspaces: ${names}`,
  };
}

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
      const ws = findWorkspace(all, target);
      if (!ws) return unknownWorkspace(all, target);
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

    async launch(target: string): Promise<LaunchResult> {
      const all = deps.getWorkspaces();
      const ws = findWorkspace(all, target);
      if (!ws) return unknownWorkspace(all, target);
      if (ws.isSelf) {
        return {
          ok: false,
          error: `refused: ${ws.name} is the orchestrator itself`,
        };
      }
      if (deps.hasPty(ws.id)) {
        return { ok: false, error: `${ws.name} already has a live session` };
      }
      // read before the spawn: the session itself writes the flag once answered
      const trusted = await deps.isTrusted(ws);
      if (!(await deps.launch(ws))) {
        return {
          ok: false,
          error: `${ws.name}'s session failed to start — is the claude CLI on PATH?`,
        };
      }
      return trusted === false
        ? { ok: true, trustPrompt: ws.rootPath }
        : { ok: true };
    },

    /** Answers a fresh session's folder-trust prompt with the user's choice.
     * Keys go in only while Claude Code's config still says untrusted, so they
     * can never land in a live composer. */
    async trust(target: string, accept: boolean): Promise<SendResult> {
      const all = deps.getWorkspaces();
      const ws = findWorkspace(all, target);
      if (!ws) return unknownWorkspace(all, target);
      if (ws.isSelf) {
        return {
          ok: false,
          error: `refused: ${ws.name} is the orchestrator itself`,
        };
      }
      if (!deps.hasPty(ws.id)) {
        return {
          ok: false,
          error: `${ws.name} has no session — launch it first`,
        };
      }
      const trusted = await deps.isTrusted(ws);
      if (trusted === null) {
        return {
          ok: false,
          error:
            "could not read ~/.claude.json, so there is no telling whether a " +
            `trust prompt is showing — ask the user to answer it in ${ws.name}'s terminal`,
        };
      }
      if (trusted) {
        return {
          ok: false,
          error: `${ws.name}'s folder is already trusted — there is no prompt to answer`,
        };
      }
      // "No, exit" is the highlighted choice, so declining is Enter alone
      if (!accept) {
        deps.write(ws.id, "\r");
        return { ok: true };
      }
      const quiet = deps.waitQuiet(ws.id);
      // separate writes: one chunk holding both keys reads as a paste
      deps.write(ws.id, TRUST_DOWN);
      await new Promise((r) => setTimeout(r, KEY_GAP_MS));
      deps.write(ws.id, "\r");
      await quiet;
      if (!deps.hasPty(ws.id)) {
        return {
          ok: false,
          error: `${ws.name}'s session exited — the prompt did not take "Yes"`,
        };
      }
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
      // Nobody is parked, so nothing would read the queue on its own — a
      // Claude Code session at an idle prompt does not act. The nudge is what
      // starts the turn that drains it. A parked waiter returned above and
      // never reaches here, so a finish wakes the agent exactly one way.
      deps.nudgeMain();
    },

    watch(
      timeoutSeconds = WATCH_DEFAULT_S,
      signal?: AbortSignal,
    ): Promise<WatchResult> {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      const secs = Math.min(
        Math.max(Number(timeoutSeconds) || WATCH_DEFAULT_S, 1),
        WATCH_MAX_S,
      );
      return new Promise<WatchResult>((resolve) => {
        if (signal?.aborted) return resolve({ timeout: true });
        const fire = (f: Finish) => {
          clearTimeout(timer);
          resolve(f);
        };
        // a timeout and a caller that walks away both drop the parked
        // resolver, or the next finish resolves a promise nobody is holding
        // and the entry is lost
        const release = () => {
          clearTimeout(timer);
          if (waiter === fire) waiter = null;
          resolve({ timeout: true });
        };
        const timer = setTimeout(release, secs * 1000);
        signal?.addEventListener("abort", release, { once: true });
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
