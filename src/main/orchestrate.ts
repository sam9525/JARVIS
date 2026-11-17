import {
  cleanLabel,
  MAIN_LABEL,
  parseSessionKey,
  shownName,
} from "../shared/session-key";
import type {
  AgentId,
  StatusKind,
  TurnEnd,
  Workspace,
  WorkspaceKind,
  WorkspaceStatus,
} from "../shared/types";
import { AGENT_LABELS } from "../shared/agent-labels";
import { agentById } from "./agents";
import type { ReadyState } from "./agents/ready-gate";
import type { AskPrompt } from "./ask-mapper";
import type { ClosedSession } from "./closed-sessions";
import { commandWord } from "./command-wait";
import { PASTE_END, PASTE_START } from "./pending-input";
import type { SessionInfo } from "./sessions";
import { topicWord } from "./transcript-title";

// The orchestrator feature's logic, pure over injected deps — no HTTP, no
// Electron. http-listener exposes it on /orchestrate/*; index.ts wires the
// real workspaces/status/pty in. Every PTY call takes a session key.
export interface OrchestrateDeps {
  getWorkspaces: () => Workspace[];
  snapshot: () => WorkspaceStatus[];
  // every session JARVIS launched for the workspace and has not closed,
  // live or exited
  sessionsOf: (workspaceId: string) => SessionInfo[];
  // closed sessions of the workspace whose transcript can still be resumed
  closedOf: (workspaceId: string) => ClosedSession[];
  hasPty: (key: string) => boolean;
  // true while the user has typed into the session's terminal and not sent it
  hasPendingInput: (key: string) => boolean;
  hasDraft: (key: string) => boolean;
  write: (key: string, data: string) => boolean;
  // the launch the tab bar's `+` makes; no label means the next free number.
  // error "cap" means the workspace already has its four live sessions.
  // resumeId continues that Claude conversation instead of starting empty;
  // no agent means Claude
  launch: (
    ws: Workspace,
    label: string | undefined,
    resumeId?: string,
    agent?: AgentId,
  ) => Promise<{
    ok: boolean;
    key?: string;
    label?: string;
    worktree?: string;
    error?: string;
  }>;
  // ends the session; `kept` names a worktree left on disk and why
  close: (
    key: string,
  ) => Promise<{ ok: boolean; kept?: string; damaged?: string }>;
  // Claude Code's own record of the folder-trust prompt; null = unreadable
  isTrusted: (folder: string) => Promise<boolean | null>;
  // the agent's own trust list for the folder; null = the agent keeps none
  agentTrusted: (
    agent: AgentId | undefined,
    cwd: string,
  ) => Promise<boolean | null>;
  // resolves once the session's TUI has stopped painting (or a deadline passed)
  waitQuiet: (key: string) => Promise<boolean>;
  // ms since the PTY last printed anything; Infinity = no output seen
  msSinceOutput: (key: string) => number;
  // a non-Claude session's gate state; undefined for a Claude session
  readyState: (key: string) => ReadyState | undefined;
  markDelegated: (key: string, by: string) => void;
  // pins the tab's topic so the session's own title cannot replace it
  nameSession: (key: string, word: string) => void;
  // false = no renderer listening; say() reports that rather than going silent
  say: (text: string) => boolean;
  // types the nudge naming the workspace and tab into the main agent's own
  // session, so a finish reaches it without anyone having parked on jarvis_watch first
  nudgeMain: (workspace: string, tab: string) => void;
  // registers before the write; true when the transcript shows the command ran
  waitCommand: (key: string, word: string) => Promise<boolean>;
  noteDelivered: (key: string) => void;
  // shows or (no questions) clears the question panel for a session
  ask: (prompt: AskPrompt) => void;
  // whether resuming this transcript likely opens Claude Code's resume menu
  resumeMenuLikely: (key: string, resumeId: string) => Promise<boolean>;
}

// An arrow only moves the resume menu's cursor; any other key answers it.
const ARROWS = new Set(["\x1b[A", "\x1b[B"]);

// "/model <name>" in a conversation with history stops on Claude Code's own
// "Switch model?" confirm, which no hook reports. A transcript that stays
// silent this long after the write is read as that confirm being open.
export const MODEL_CONFIRM_MS = 1500;

// one jarvis_list row per live session, or one per workspace that has none
export interface FleetEntry {
  name: string;
  session: string; // "" when the workspace has no live session
  worktree: string; // "" when the session shares the workspace folder
  topic: string; // "" when the session has none
  kind: WorkspaceKind;
  status: StatusKind;
  call: string;
  message: string;
  live: boolean;
  delegatedBy: string;
  agent: AgentId;
  ended?: TurnEnd;
  error?: string;
  // a session that has closed and can be resumed with jarvis_launch
  closed?: true;
  closedAt?: string;
}

export type SendResult = { ok: true } | { ok: false; error: string };
type Failure = { ok: false; error: string };
// a new session left open on its agent's trust question, named so the caller
// can point the user at its tab
type TrustRefusal = Failure & { session: string; worktree?: string };

/** `trustPrompt` is the folder a new session is asking the user to trust —
 * a send before jarvis_trust answers it would land on that prompt. */
export type DeliveredResult =
  | {
      ok: true;
      session?: string;
      worktree?: string;
      trustPrompt?: string;
      // set for a slash command: false = the wait ran out before it showed
      finished?: boolean;
    }
  | Failure
  | TrustRefusal;

export type LaunchResult =
  | { ok: true; session: string; worktree?: string; trustPrompt?: string }
  | Failure
  | TrustRefusal;

export type CloseResult =
  { ok: true; kept?: string; damaged?: string } | Failure;

export interface SendOptions {
  session?: string;
  fresh?: boolean;
  // names a fresh session's tab; ignored without `fresh`
  label?: string;
  // the fresh session's agent; ignored without `fresh`
  agent?: AgentId;
}

// the trust prompt opens on "No, exit": Down moves to "Yes", Enter confirms
const TRUST_DOWN = "\x1b[B";
const KEY_GAP_MS = 80;
// A prompt over 1024 bytes reaches the TUI in 1024-byte pieces, and a busy TUI
// can keep only the last piece.
const MAX_PLAIN_BYTES = 1024;

/** The bytes to write for a prompt. A paste block has an explicit end marker,
 * so it does not depend on how the TUI reads the pieces. A short single line
 * stays plain because a slash command inside a paste is text. ESC is dropped
 * so no prompt text can close or open a block. */
export function sendPayload(prompt: string): string {
  const text = prompt
    .replace(/\r\n?/g, "\n")
    .replaceAll("\x1b", "")
    // every other C0 control and DEL; tab and newline stay for multi-line prompts
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .trimEnd();
  if (!text.includes("\n") && Buffer.byteLength(text) <= MAX_PLAIN_BYTES)
    return text;
  return PASTE_START + text + PASTE_END;
}

const BUSY: ReadonlySet<StatusKind> = new Set(["working", "asking", "blocked"]);

/** Only a summary is spoken, and this cap is what enforces that: a whole
 * project output pasted in is rejected with an error naming the number. */
export const MAX_SAY = 500;
/** A close refuses a terminal that printed within this window: a long Bash
 * call sends no hook, so its status can read idle while it still runs. */
export const CLOSE_QUIET_MS = 2000;
export const WATCH_DEFAULT_S = 60;
export const WATCH_MAX_S = 300;
/** A watcher that has been away long enough to bank 50 finishes is not
 * watching. Past the cap the oldest goes. */
export const QUEUE_MAX = 50;

type Finish = {
  workspace: string;
  session: string;
  topic?: string;
  message: string;
  ended: TurnEnd;
  error?: string;
};

export type WatchResult = Finish | { timeout: true };

function endingOf(
  r: { ended?: TurnEnd; error?: string } | undefined,
): Pick<FleetEntry, "ended" | "error"> {
  return {
    ...(r?.ended ? { ended: r.ended } : {}),
    ...(r?.error ? { error: r.error } : {}),
  };
}

function findWorkspace(all: Workspace[], target: string) {
  const q = String(target ?? "")
    .trim()
    .toLowerCase();
  return all.find((w) => w.name.toLowerCase() === q || w.id === q);
}

function unknownWorkspace(all: Workspace[], target: string): Failure {
  const names = all.map((w) => w.name).join(", ");
  return {
    ok: false,
    error: `no workspace "${target}" — workspaces: ${names}`,
  };
}

const sameLabel = (a: string, b: string) =>
  a.toLowerCase() === b.trim().toLowerCase();

const worktreeOf = (s: SessionInfo) => (s.worktree ? s.cwd : "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createOrchestrator(deps: OrchestrateDeps) {
  const topicOf = (workspaceId: string, key: string) =>
    deps
      .snapshot()
      .find((r) => r.workspaceId === workspaceId)
      ?.sessions.find((s) => s.key === key)?.topic ?? "";

  // "label (topic)" for a session that has a topic, else the bare label
  const labels = (list: SessionInfo[], ws: Workspace) =>
    list
      .map((s) => {
        const topic = topicOf(ws.id, s.key);
        return topic ? `${s.label} (${topic})` : s.label;
      })
      .join(", ");

  // the live non-main sessions a tab name is judged against: the same set the
  // tab strip uses, so a spoken name and a shown name agree
  const tabSiblings = (workspaceId: string) =>
    (
      deps.snapshot().find((r) => r.workspaceId === workspaceId)?.sessions ?? []
    ).filter((s) => s.live && s.label !== MAIN_LABEL);

  // a label wins; then the name a tab shows (topic, or topic + label when
  // another tab shares it); then the one session whose bare topic matches
  function findSession(
    list: SessionInfo[],
    name: string,
    ws: Workspace,
  ): SessionInfo | undefined {
    const byLabel = list.find((s) => sameLabel(s.label, name));
    if (byLabel) return byLabel;
    const siblings = tabSiblings(ws.id);
    const byShown = list.find((s) => {
      const row = siblings.find((r) => r.key === s.key);
      return row !== undefined && sameLabel(shownName(row, siblings), name);
    });
    if (byShown) return byShown;
    const byTopic = list.filter((s) => {
      const topic = topicOf(ws.id, s.key);
      return topic !== "" && sameLabel(topic, name);
    });
    return byTopic.length === 1 ? byTopic[0] : undefined;
  }

  // A Claude Code session cannot act on its own, so jarvis_watch parks until a
  // delegate finishes. One shared queue is correct because the topology
  // guarantees one watcher: mcp-install writes .mcp.json into the isSelf
  // workspace only. No cursor to thread, no per-caller state.
  const queue: Finish[] = [];
  let waiter: ((f: Finish) => void) | null = null;

  // the workspace a tool names, minus the orchestrator itself: self-send is
  // the one loop the one-orchestrator topology can't rule out
  function delegate(target: string): Workspace | Failure {
    const all = deps.getWorkspaces();
    const ws = findWorkspace(all, target);
    if (!ws) return unknownWorkspace(all, target);
    if (ws.isSelf) {
      return {
        ok: false,
        error: `refused: ${ws.name} is the orchestrator itself`,
      };
    }
    return ws;
  }

  const liveSessions = (ws: Workspace) =>
    deps.sessionsOf(ws.id).filter((s) => deps.hasPty(s.key));

  // the named live session, else the only one; several and none named is a
  // refusal, so a prompt never lands in a session the agent did not mean
  function pickSession(
    ws: Workspace,
    session: string | undefined,
  ): SessionInfo | Failure {
    const live = liveSessions(ws);
    if (live.length === 0) {
      return {
        ok: false,
        error: `${ws.name} has no session — launch it first`,
      };
    }
    if (session !== undefined && session.trim()) {
      const named = findSession(live, session, ws);
      return (
        named ?? {
          ok: false,
          error: `${ws.name} has no live session "${session}" — sessions: ${labels(live, ws)}`,
        }
      );
    }
    if (live.length > 1) {
      return {
        ok: false,
        error: `${ws.name} has several sessions — pass session: ${labels(live, ws)}`,
      };
    }
    return live[0];
  }

  const sessionKind = (key: string, workspaceId: string): StatusKind =>
    deps
      .snapshot()
      .find((r) => r.workspaceId === workspaceId)
      ?.sessions.find((s) => s.key === key)?.kind ?? "none";

  /** Why a session cannot close yet, phrased to follow `is `; null when it can.
   * `turnEnded` skips the output-quiet rule: the session's own Stop already
   * says its turn is over, and its terminal repaints right after. */
  function closeBlocker(
    key: string,
    workspaceId: string,
    turnEnded = false,
  ): string | null {
    const kind = sessionKind(key, workspaceId);
    if (BUSY.has(kind)) {
      return `busy (${kind}) — it can close once its turn ends`;
    }
    if (
      !turnEnded &&
      deps.hasPty(key) &&
      deps.msSinceOutput(key) < CLOSE_QUIET_MS
    ) {
      return "busy (output in the last 2 s) — it can close once it goes quiet";
    }
    return null;
  }

  /** Why `closeIfIdle` would leave a session open, phrased to follow `is `;
   * null when it would close. A session that is unknown counts as refused. */
  function idleCloseRefusal(key: string, turnEnded = false): string | null {
    const owner = deps
      .getWorkspaces()
      .find((w) => deps.sessionsOf(w.id).some((s) => s.key === key));
    if (!owner) return "not open";
    const blocker = closeBlocker(key, owner.id, turnEnded);
    if (blocker) return blocker;
    // The user answers a question in this tab, so it must outlive the merge.
    const row = deps
      .snapshot()
      .find((r) => r.workspaceId === owner.id)
      ?.sessions.find((s) => s.key === key);
    if (row?.ended === "question") {
      return "waiting on your answer to its question";
    }
    if (deps.hasPendingInput(key) || deps.hasDraft(key)) {
      return "holding unsent text";
    }
    return null;
  }

  function capError(ws: Workspace): Failure {
    const live = liveSessions(ws);
    const rows = live
      .map((s) => `${s.label} (${sessionKind(s.key, ws.id)})`)
      .join(", ");
    return {
      ok: false,
      error: `${ws.name} has ${live.length} sessions: ${rows} — ask the user which to close`,
    };
  }

  // An agent's trust question takes Enter as its answer, so no prompt may be
  // typed into a session that still shows one.
  function agentTrustError(
    ws: Workspace,
    agent: AgentId | undefined,
    label: string,
  ): Failure {
    return {
      ok: false,
      error: `${ws.name}'s ${AGENT_LABELS[agentById(agent).id]} session "${label}" shows its trust question — ask the user to answer it in the terminal, then send again`,
    };
  }

  // the agent's own trust list for the folder; null for an agent whose trust
  // prompt Claude Code's record answers
  const agentTrust = (agent: AgentId | undefined, cwd: string) =>
    agentById(agent).features.trustCheck
      ? Promise.resolve(null)
      : deps.agentTrusted(agent, cwd);

  function launchFailure(ws: Workspace, error: string | undefined): Failure {
    const start = `${ws.name}'s session failed to start`;
    if (error === "Codex not found")
      return {
        ok: false,
        error: `${start} — Codex not found: install the Codex app or put codex.exe on PATH`,
      };
    if (error === "Antigravity not found")
      return {
        ok: false,
        error: `${start} — Antigravity not found: install the Antigravity CLI (agy)`,
      };
    return {
      ok: false,
      error: `${start} — is the claude CLI on PATH? (${error ?? "unknown error"})`,
    };
  }

  // Opens a session and waits for its TUI to go quiet, since text written
  // before raw mode is dropped. Trust is read for the session's own folder,
  // which for a worktree is not the workspace root. A session showing its
  // agent's own trust question stays open and is reported as a failure, so
  // no caller writes into it.
  async function open(
    ws: Workspace,
    label: string | undefined,
    topic = "",
    resumeId?: string,
    agent?: AgentId,
  ) {
    const out = await deps.launch(ws, label, resumeId, agent);
    if (!out.ok || !out.key) {
      if (out.error === "cap") return capError(ws);
      return launchFailure(ws, out.error);
    }
    if (topic) deps.nameSession(out.key, topic);
    // The spawn is synchronous and PTY output arrives as I/O callbacks, which
    // cannot run before this continuation: the waiter exists before the first
    // chunk, as the settle needs.
    const quiet = deps.waitQuiet(out.key);
    const folder = out.worktree ?? ws.rootPath;
    const trusted = agentById(agent).features.trustCheck
      ? await deps.isTrusted(folder)
      : null;
    if ((await agentTrust(agent, folder)) === false) {
      const session = out.label ?? "";
      const refusal: TrustRefusal = {
        ...agentTrustError(ws, agent, session),
        session,
        ...(out.worktree ? { worktree: out.worktree } : {}),
      };
      return refusal;
    }
    const settled = await quiet;
    return {
      ok: true as const,
      key: out.key,
      session: out.label ?? "",
      worktree: out.worktree,
      trustPrompt: trusted === false ? folder : undefined,
      settled,
    };
  }

  // A fresh session has no history, so only a send to a live one can hit the
  // confirm. The panel closes when the transcript shows /model ran; a confirm
  // left past the command deadline keeps its panel until the user types in
  // the terminal or the session ends.
  function askModelConfirm(
    workspaceId: string,
    key: string,
    model: string,
    ran: Promise<boolean>,
  ): void {
    const base = { workspaceId, sessionKey: key, sessionId: "" };
    let shown = false;
    const timer = setTimeout(() => {
      shown = true;
      deps.ask({
        ...base,
        ts: Date.now(),
        source: "confirm",
        questions: [
          {
            question: "Switch model?",
            header: "",
            multiSelect: false,
            options: [
              { label: `Yes, switch to ${model}`, description: "" },
              { label: "No, go back", description: "" },
            ],
          },
        ],
      });
    }, MODEL_CONFIRM_MS);
    void ran.then((confirmed) => {
      clearTimeout(timer);
      if (shown && confirmed)
        deps.ask({ ...base, ts: Date.now(), questions: [] });
    });
  }

  // sessions whose resume menu may be open: an Enter there picks a row, and
  // the focused row can be "Resume from summary", which runs /compact
  // session key → workspace id
  const resumeMenus = new Map<string, string>();

  // Esc is the only key that means the same in every resume menu: resume the
  // full session as-is. The other rows are left to the terminal.
  function askResumeMenu(workspaceId: string, key: string): void {
    resumeMenus.set(key, workspaceId);
    deps.ask({
      workspaceId,
      sessionKey: key,
      sessionId: "",
      ts: Date.now(),
      source: "confirm",
      questions: [
        {
          question: "Resume this session?",
          header: "",
          multiSelect: false,
          options: [
            {
              label: "Resume as-is",
              description:
                "Keeps the full session. For a summary, pick it in the terminal.",
              keys: "\x1b",
            },
          ],
        },
      ],
    });
  }

  function closeResumeMenu(key: string): void {
    const workspaceId = resumeMenus.get(key);
    if (workspaceId === undefined) return;
    resumeMenus.delete(key);
    deps.ask({
      workspaceId,
      sessionKey: key,
      sessionId: "",
      ts: Date.now(),
      questions: [],
    });
  }

  function deliver(key: string, prompt: string): boolean {
    // the caller sends no identity — it can only be the one workspace that
    // has the tools, which mcp-install pins to isSelf
    const by = deps.getWorkspaces().find((w) => w.isSelf)?.name ?? "JARVIS";
    // the session can die between the hasPty probe and the write, so mark the
    // delegation only once the prompt is actually in the PTY
    if (!deps.write(key, sendPayload(prompt))) return false;
    deps.markDelegated(key, by);
    deps.noteDelivered(key);
    // Claude Code's TUI treats one arriving chunk as a paste, so a trailing
    // "\r" lands as a newline in the composer instead of submitting. Send the
    // CR as its own write a beat later, after the end marker of a paste block —
    // indistinguishable from typing Enter.
    // ponytail: fixed 80ms, not a prompt-ready probe — bump if a busy TUI misses it
    // ponytail: send has already returned by the time the CR lands, so a session
    // that dies inside the 80ms leaves the prompt unsubmitted and only surfaces
    // as the delegate going stale in jarvis_list. Await delivery if that bites.
    setTimeout(() => deps.write(key, "\r"), KEY_GAP_MS);
    return true;
  }

  const orchestrator = {
    list(): FleetEntry[] {
      const byId = new Map(deps.snapshot().map((s) => [s.workspaceId, s]));
      return deps.getWorkspaces().flatMap((w): FleetEntry[] => {
        const row = byId.get(w.id);
        const base = {
          name: w.name,
          kind: w.kind,
          message: row?.message ?? "",
          delegatedBy: row?.delegatedBy ?? "",
          agent: "claude" as const,
        };
        const closed = deps.closedOf(w.id).map((c): FleetEntry => ({
          name: w.name,
          kind: w.kind,
          message: "",
          delegatedBy: "",
          agent: "claude",
          session: c.label,
          worktree: "",
          topic: c.topic,
          status: "none",
          call: "",
          live: false,
          closed: true,
          closedAt: new Date(c.closedAt).toISOString(),
        }));
        const live = liveSessions(w);
        if (live.length === 0) {
          return [
            {
              ...base,
              session: "",
              worktree: "",
              topic: "",
              status: row?.kind ?? "none",
              call: row?.call ?? "",
              // the main agent's own pty is keyed by its workspace id and is
              // not in the session registry
              live: deps.hasPty(w.id),
              ...endingOf(row),
            },
            ...closed,
          ];
        }
        const rows = live.map((s) => {
          const own = row?.sessions.find((r) => r.key === s.key);
          return {
            ...base,
            session: s.label,
            worktree: worktreeOf(s),
            topic: own?.topic ?? "",
            status: own?.kind ?? "none",
            call: own?.call ?? "",
            live: true,
            agent: s.agent ?? "claude",
            ...endingOf(own),
          };
        });
        return [...rows, ...closed];
      });
    },

    /** A key the user typed into a session, from the terminal or the panel. */
    resumeMenuKeyed(key: string, data: string): void {
      if (!ARROWS.has(data)) closeResumeMenu(key);
    },

    resumeMenuEnded(key: string): void {
      closeResumeMenu(key);
    },

    /** `fresh` opens a new session and sends there; otherwise the prompt goes
     * to the named session, or the only live one. */
    async send(
      target: string,
      prompt: string,
      opts: SendOptions = {},
    ): Promise<DeliveredResult> {
      const ws = delegate(target);
      if ("ok" in ws) return ws;
      if (!String(prompt ?? "").trim()) {
        return { ok: false, error: "empty prompt" };
      }
      if (opts.fresh) {
        // the key keeps the next free number; the label only titles the tab
        const word = ws.isScratch ? "" : topicWord(opts.label ?? "", ws.name);
        const opened = await open(
          ws,
          undefined,
          word === MAIN_LABEL ? "" : word,
          undefined,
          opts.agent,
        );
        if (!opened.ok) return opened;
        const where = {
          session: opened.session,
          ...(opened.worktree ? { worktree: opened.worktree } : {}),
        };
        if (opened.trustPrompt) {
          return { ok: true, ...where, trustPrompt: opened.trustPrompt };
        }
        if (!opened.settled) {
          return {
            ok: false,
            error: `${ws.name}'s new session "${opened.session}" did not settle — prompt not sent`,
          };
        }
        const command = commandWord(prompt);
        const ran = command ? deps.waitCommand(opened.key, command) : null;
        if (!deps.hasPty(opened.key) || !deliver(opened.key, prompt)) {
          return {
            ok: false,
            error: `${ws.name}'s new session "${opened.session}" ended before the prompt`,
          };
        }
        return { ok: true, ...where, ...(ran ? { finished: await ran } : {}) };
      }
      const s = pickSession(ws, opts.session);
      if ("ok" in s) return s;
      // a send would append to the user's half-typed text
      if (deps.hasPendingInput(s.key)) {
        return {
          ok: false,
          error: `${ws.name}'s session "${s.label}" has text the user has not sent — send with fresh: true instead`,
        };
      }
      if (resumeMenus.has(s.key)) {
        return {
          ok: false,
          error: `${ws.name}'s session "${s.label}" may be showing Claude Code's resume menu — ask the user to answer it, or send with fresh: true`,
        };
      }
      if ((await agentTrust(s.agent, s.cwd)) === false)
        return agentTrustError(ws, s.agent, s.label);
      // the Enter would pick an option in the open prompt
      const kind = sessionKind(s.key, ws.id);
      if (kind === "asking" || kind === "blocked") {
        return {
          ok: false,
          error: `${ws.name}'s session "${s.label}" is ${kind}, waiting on the user — ask them to answer it, or send with fresh: true`,
        };
      }
      // after its first prompt, a gated session takes a send only once its
      // turn has ended
      if (deps.readyState(s.key) === "used") {
        const row = deps
          .snapshot()
          .find((r) => r.workspaceId === ws.id)
          ?.sessions.find((r) => r.key === s.key);
        if (row?.kind !== "idle" || !row.ended) {
          return {
            ok: false,
            error: `${ws.name}'s ${AGENT_LABELS[agentById(s.agent).id]} session "${s.label}" has not ended its turn — wait for its finish, or send with fresh: true`,
          };
        }
      }
      const command = commandWord(prompt);
      const ran = command ? deps.waitCommand(s.key, command) : null;
      if (!deliver(s.key, prompt)) {
        return {
          ok: false,
          error: `${ws.name}'s session ended before delivery`,
        };
      }
      const model = prompt.trim().split(/\s+/);
      if (ran && command === "/model" && model.length === 2)
        askModelConfirm(ws.id, s.key, model[1], ran);
      return {
        ok: true,
        session: s.label,
        ...(s.worktree ? { worktree: s.cwd } : {}),
        ...(ran ? { finished: await ran } : {}),
      };
    },

    /** `resume` continues the label's last closed conversation. A live
     * session holding that label is closed first, only when it is idle. */
    async launch(
      target: string,
      label?: string,
      resume = false,
      agent?: AgentId,
    ): Promise<LaunchResult> {
      const ws = delegate(target);
      if ("ok" in ws) return ws;
      const cleaned = cleanLabel(String(label ?? "")) || undefined;
      // session keys compare against MAIN_LABEL exactly, so any case of
      // "main" is normalised before it reaches deps.launch
      let wanted =
        cleaned && sameLabel(MAIN_LABEL, cleaned) ? MAIN_LABEL : cleaned;
      if (!wanted) {
        // no label: the main tab, or a side tab while main is mid-turn
        const main = liveSessions(ws).find((s) => s.label === MAIN_LABEL);
        if (!main || !BUSY.has(sessionKind(main.key, ws.id))) {
          wanted = MAIN_LABEL;
        }
      }
      let resumeId: string | undefined;
      if (resume) {
        const label = wanted ?? MAIN_LABEL;
        const record = deps
          .closedOf(ws.id)
          .find((c) => sameLabel(c.label, label));
        if (!record) {
          return {
            ok: false,
            error: `${ws.name} has no closed session "${label}" to resume — launch without resume`,
          };
        }
        // read before the close below, which records the live one in its place
        resumeId = record.sessionId;
        wanted = record.label;
        const holder = liveSessions(ws).find((s) =>
          sameLabel(s.label, record.label),
        );
        if (holder) {
          const reason = idleCloseRefusal(holder.key);
          if (reason !== null) {
            return {
              ok: false,
              error: `${ws.name}'s live session "${holder.label}" is ${reason} — it was not replaced`,
            };
          }
          await orchestrator.closeIfIdle(holder.key);
        }
      }
      if (wanted && liveSessions(ws).some((s) => sameLabel(s.label, wanted))) {
        return {
          ok: false,
          error: `${ws.name} already has a live session "${wanted}" — jarvis_send to it`,
        };
      }
      // a resume reopens a Claude conversation, so it ignores agent
      const opened = await open(
        ws,
        wanted,
        "",
        resumeId,
        resume ? undefined : agent,
      );
      if (!opened.ok) return opened;
      if (resumeId && (await deps.resumeMenuLikely(opened.key, resumeId)))
        askResumeMenu(ws.id, opened.key);
      return {
        ok: true,
        session: opened.session,
        ...(opened.worktree ? { worktree: opened.worktree } : {}),
        ...(opened.trustPrompt ? { trustPrompt: opened.trustPrompt } : {}),
      };
    },

    /** Ends a session the user named. A turn in flight is never cut off:
     * a working, asking or blocked session is refused. */
    async close(target: string, session: string): Promise<CloseResult> {
      const ws = delegate(target);
      if ("ok" in ws) return ws;
      const known = deps.sessionsOf(ws.id);
      const s = findSession(known, String(session ?? ""), ws);
      if (!s) {
        return {
          ok: false,
          error: `${ws.name} has no session "${session}" — sessions: ${labels(known, ws) || "none"}`,
        };
      }
      const blocker = closeBlocker(s.key, ws.id);
      if (blocker) {
        return {
          ok: false,
          error: `${ws.name}'s session "${s.label}" is ${blocker}`,
        };
      }
      const out = await deps.close(s.key);
      return {
        ok: true,
        ...(out.kept ? { kept: out.kept } : {}),
        ...(out.damaged ? { damaged: out.damaged } : {}),
      };
    },

    /** Closes a session by key when it is idle and quiet, under the same busy
     * rule as `close`, and holds no unsent text or draft. False means it was left open.
     * `turnEnded` is for the session whose own Stop asked for the check. */
    async closeIfIdle(key: string, turnEnded = false): Promise<boolean> {
      if (idleCloseRefusal(key, turnEnded) !== null) return false;
      await deps.close(key);
      return true;
    },

    /** Answers a new session's folder-trust prompt with the user's choice.
     * Keys go in only while Claude Code's config still says untrusted, so they
     * can never land in a live composer. */
    async trust(
      target: string,
      accept: boolean,
      session?: string,
    ): Promise<SendResult> {
      const ws = delegate(target);
      if ("ok" in ws) return ws;
      const s = pickSession(ws, session);
      if ("ok" in s) return s;
      const adapter = agentById(s.agent);
      if (adapter.features.trustCheck === false) {
        return {
          ok: false,
          error: `${ws.name}'s session "${s.label}" runs ${AGENT_LABELS[adapter.id]}, which answers its own trust question in its terminal`,
        };
      }
      const trusted = await deps.isTrusted(s.cwd);
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
        deps.write(s.key, "\r");
        return { ok: true };
      }
      const quiet = deps.waitQuiet(s.key);
      // separate writes: one chunk holding both keys reads as a paste
      deps.write(s.key, TRUST_DOWN);
      await sleep(KEY_GAP_MS);
      deps.write(s.key, "\r");
      await quiet;
      if (!deps.hasPty(s.key)) {
        return {
          ok: false,
          error: `${ws.name}'s session exited — the prompt did not take "Yes"`,
        };
      }
      return { ok: true };
    },

    publishFinish(
      sessionKey: string,
      message: string,
      ended: TurnEnd = "finished",
      error?: string,
    ): void {
      const text = String(message ?? "").trim();
      if (!text) return;
      const all = deps.getWorkspaces();
      const { workspaceId, label } = parseSessionKey(
        sessionKey,
        all.map((w) => w.id),
      );
      const ws = all.find((w) => w.id === workspaceId);
      // the orchestrator waking on its own turn ending is a loop with itself
      if (!ws || ws.isSelf) return;
      const siblings = tabSiblings(ws.id);
      const own = siblings.find((r) => r.key === sessionKey);
      const finish: Finish = {
        workspace: ws.name,
        session: label,
        ...(own?.topic ? { topic: shownName(own, siblings) } : {}),
        message: text,
        ended,
        ...(error ? { error } : {}),
      };
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
      deps.nudgeMain(finish.workspace, finish.topic ?? finish.session);
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
  return orchestrator;
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
