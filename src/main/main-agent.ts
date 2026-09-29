import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeId } from "./workspaces";
import type { Workspace } from "../shared/types";

export const MAIN_AGENT_NAME = "Main Agent";

// The fleet dispatcher reads statuses and writes summaries; it never edits
// code, so the cheap model is the right one.
export const MAIN_AGENT_MODEL = "sonnet";

/** The cockpit's orchestrator session, rooted in its own userData folder
 * rather than the JARVIS repo — the repo's session is where a human writes
 * code, and its turn-end messages must not be spoken. `kind: "vault"` keeps
 * `canIndex` false; the folder holds no graph to index. */
export function mainAgentWorkspace(rootPath: string): Workspace {
  return {
    id: normalizeId(rootPath),
    name: MAIN_AGENT_NAME,
    rootPath,
    kind: "vault",
    sourceId: "unknown",
    isSelf: true,
  };
}

/** `isSelf` is the whole topology: it decides who gets `.mcp.json`, who
 * `jarvis_send` refuses, whose turn ending is skipped by `publishFinish`, and
 * whose message is spoken. Exactly one workspace may carry it, so the others
 * are cleared here rather than trusted to be clean. */
export function withMainAgent(
  workspaces: Workspace[],
  main: Workspace,
): Workspace[] {
  const others = workspaces
    .filter((w) => w.id !== main.id)
    .map((w) => {
      const result = { ...w };
      delete result.isSelf;
      return result;
    });
  return [...others, main];
}

/** Written into the main-agent folder on first boot and never rewritten. This
 * is the one piece of agent-facing text the app authors: it is static, it is
 * a file rather than a prompt, and the user may edit it freely afterwards.
 * ponytail: `wx` means a guide from an older version is never refreshed —
 * delete the file to pick up a new one, or store a version alongside it if
 * that stops being rare. */
export const AGENT_GUIDE = `# Main Agent

You are the JARVIS cockpit's main agent. You do not write code. You speak for
the fleet.

## What starts your turn

The app types a line into this session whenever a workspace finishes. You do
not poll and you do not wait — when you are reading this, one workspace has
already finished and its message is waiting for you to take.

1. Call \`jarvis_watch\` with \`timeout_seconds: 1\`. The finish is already
   queued, so it returns at once with the \`workspace\` and \`message\` of the one
   session that just finished.
2. Summarise that one workspace alone. The others are not your turn — you were
   not woken for them, and each was spoken for when it finished.
3. Reply in as few words as possible: which workspace, and what matters — what
   it did, what it needs, any key considerations. One sentence if it fits, two at most.
4. Stop. Do not call \`jarvis_list\` to look for more, and do not watch again.

If watch times out, the finish was already handled. Say nothing and end the
turn.

Your turn-end message is read aloud in full, so it is the summary and nothing
else. Someone is listening, not reading — say the outcome, not the steps that
produced it. Cut every word the listener would not act on. No preamble, no
lists, no file names, no markdown, no code. Use \`jarvis_say\` when you
need to speak without ending a turn.

## To-do list

The user's own to-do list is \`TODO.md\` in this folder. Call \`jarvis_todos\`
for any question about it ("show me the todo list", "what should we do next")
— it opens the list on screen and returns the file's path and text. One task
per line: \`- [ ] text @project YYYY-MM-DD\`, \`- [x]\` when done, no \`@\` for
a personal task, and today's date on every task you add. Call
\`jarvis_todos\` again after each edit and fix any line it reports as
malformed. Answer with the next open task in one spoken sentence.

## Tools

- \`jarvis_watch\` — take the next finish off the queue, or park until one
  arrives. This is how a nudged turn reads what happened.
- \`jarvis_list\` — every workspace, its status, and its last message. For a
  question about the whole fleet, never for a finish summary.
- \`jarvis_send\` — write a prompt into another workspace's session.
- \`jarvis_launch\` — start a session for a workspace that has none, before
  a \`jarvis_send\` to it.
- \`jarvis_say\` — speak now, mid-turn.
- \`jarvis_todos\` — open the to-do list on screen and read \`TODO.md\`.
`;

/** Typed into the main agent's session when a delegate finishes and nobody is
 * parked on `jarvis_watch`. Fixed text: it names no workspace and carries no
 * message, so the app still composes nothing about the work itself — the
 * agent reads the one finish and writes its own words.
 *
 * It sends the agent to `jarvis_watch`, not `jarvis_list`: the finish is
 * already on the queue `publishFinish` pushed it onto, so watch returns that
 * single entry. `jarvis_list` returns the whole fleet, and an agent handed the
 * whole fleet summarises the whole fleet. The 1-second timeout is what keeps a
 * stale nudge — queue already drained — from parking for the 60-second
 * default. */
export const FINISH_NUDGE =
  "A workspace just finished. Call jarvis_watch with timeout_seconds 1 — it " +
  "returns only the one workspace that just finished. Summarise that one " +
  "alone, in as few words as possible: which workspace, and the single most " +
  "important thing it did or needs. One spoken sentence if it fits, two at " +
  "most. No preamble, no list, no file names, no markdown. Ignore every other " +
  "workspace and do not call jarvis_list.";

/** The hour the daily briefing is allowed to start. A 03:00 restart is still
 * last night, and no timer is armed — the briefing is skipped, and the next
 * boot after this hour delivers it. */
export const BRIEF_AFTER_HOUR = 7;

/** Silence on the main agent's PTY that means its prompt has finished
 * painting. A nudge written before that lands in the buffer ahead of raw mode
 * and is dropped, or pasted into a half-built composer. */
export const SETTLE_MS = 1000;

/** How long the briefing waits for that silence. A session that never goes
 * quiet skips the day rather than typing over live work. */
export const SETTLE_DEADLINE_MS = 60_000;

/** Typed into the main agent's session on the first launch of a day. Fixed
 * text plus one absolute path: a location, not a description, so the app
 * still composes nothing about the work.
 *
 * The spoken-summary clause overrides AGENT_GUIDE, which tells the agent its whole
 * turn-end message is read aloud. The guide is written with `wx` and an
 * existing install never sees a new one, so the override travels in the nudge.
 */
export const dailyBriefNudge = (notePath: string): string =>
  "Daily briefing. Read this one file and nothing else: " +
  notePath +
  ". Its filename carries the date — if it is not yesterday's, say which day " +
  "it is from in your first line. Then write one short paragraph per project " +
  "the file mentions: what moved, in a line at most, then what is still open " +
  "and what to carry on with. Say nothing about a project the file does not " +
  "mention. Before those paragraphs, open with a short spoken summary: two to " +
  "four plain sentences that name each project's most important open point " +
  "or next step, in as few words as possible. No preamble, no list, no file " +
  "names, no markdown. Then a blank line, then the paragraphs — only that " +
  "first paragraph is read aloud, so this one reply may carry the rest as " +
  "text. Read, answer, stop.";

/** The folder is the PTY's cwd, so it has to exist before launch. Both writes
 * are re-run every boot: a wiped userData self-heals. */
export async function ensureMainAgent(rootPath: string): Promise<void> {
  await fs.mkdir(rootPath, { recursive: true });
  const guide = path.join(rootPath, "CLAUDE.md");
  // "wx" fails when the file is already there, which is the whole check — the
  // user owns the guide once it exists
  try {
    await fs.writeFile(guide, AGENT_GUIDE, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "EEXIST") {
      console.warn("[jarvis] failed to write main-agent guide:", err);
    }
  }
}
