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
 * whose message is spoken. Exactly one workspace may carry it, and exactly one
 * may carry `isScratch`, so the others are cleared here rather than trusted to
 * be clean. */
export function withMainAgent(
  workspaces: Workspace[],
  main: Workspace,
  scratch: Workspace,
): Workspace[] {
  const others = workspaces
    .filter((w) => w.id !== main.id && w.id !== scratch.id)
    .map((w) => {
      const result = { ...w };
      delete result.isSelf;
      delete result.isScratch;
      return result;
    });
  return [...others, scratch, main];
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
   If it finished a build, say what was built and what the user should check by
   hand, three sentences at most.
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
per line: \`- [ ] text @project YYYY-MM-DD\`, \`- [/]\` while a workspace is
working on it, \`- [x]\` when done, no \`@\` for
a personal task, and today's date on every task you add. Call
\`jarvis_todos\` again after each edit and fix any line it reports as
malformed. When the user asked about the list, answer with the next open task in one spoken sentence.

## Keeping the to-do list current

When you and the user agree a task is complete, mark it done in the same turn:
call \`jarvis_todos\`, change its \`- [ ]\` or \`- [/]\` to \`- [x]\` with Edit, then call
\`jarvis_todos\` again and fix anything listed in \`malformed\`. Agreement means the
user said it is done or approved the result. A workspace finish report saying
its work was merged into develop also counts, because nothing is merged until
the user tells a workspace to merge it. When such a report clearly matches one
open or working task in TODO.md (same project, same subject), check that task off the same
way in the same turn and name it in your spoken summary. A merge report that
covers several tasks sent together checks off each task it clearly covers, and
names each one. If an open and a working task both match, check off the working
one. A report that only says done, committed or tests pass is not agreement. If the user's
words or a merge report could match several working tasks, or none clearly,
ask which.

## Working a to-do task

When the user asks you to do an open \`@project\` task, first do the note
lookup below. Then call \`jarvis_send\` with the pipeline prompt from that
tool's description, routed to the project's main tab first:

- Main tab live and not working, asking or blocked: \`jarvis_send\` with
  \`session: "main"\`.
- Main tab not live: \`jarvis_launch\` with \`label: "main"\`, then send to
  \`main\` (handle a trust prompt as under Sessions).
- Main tab busy, or the send is refused because the user has typed text there
  that is not sent: \`jarvis_send\` with \`fresh: true\` and a one-word
  \`label\` for the task.

When the task relates to the main tab's current conversation, send on top of
it. When it is unrelated, first \`jarvis_send\` \`/clear\` to \`session: "main"\`,
then the task. A freshly launched main tab needs no \`/clear\`. This rule
overrides any older text that says every task gets a fresh session or that
\`main\` belongs to the user. A follow-up to what a session already did goes to
that session with \`jarvis_send\` and its \`session\` label, never to a new one.

When the user asks for all open tasks of one project, or several of them,
send those \`@project\` lines in one \`jarvis_send\`, routed as above, with the
batch prompt from that tool's description. The workspace decides whether they
fit one spec, and writes separate specs one at a time. Use the single-task prompt when only one task is chosen. Tasks for different projects never share a prompt.

After a send succeeds, mark each sent task line \`- [/]\` in \`TODO.md\` with
Edit, then call \`jarvis_todos\` and fix anything in \`malformed\`. "All open
tasks" means the \`- [ ]\` lines only; never send a \`- [/]\` line as part of
them. A working task the user names on its own is sent as usual and stays
\`- [/]\`.

End your turn with one sentence naming the workspace and the task, such as
"Told JARVIS to add the Working section." Say nothing about gates, approval,
what the session will do, or what you will check later. That one sentence
replaces the next-open-task sentence.

The task stays working (\`- [/]\`) through spec, plan and build. An approved
gate or a finished build is not agreement, so check it off only as described
above. When a build finishes, the session ends its message with a short list of
what the user should check by hand; say it in the nudge reply as sentences,
not a list.

## Sessions

A workspace holds up to 4 live sessions, each with a label.
Sessions other than \`main\` run in their own git worktree. \`jarvis_send\` without \`fresh\` goes to the session named by
\`session\`, or to the only live one; with several and none named it is refused
and lists the labels.

When the send answer has a \`worktree\`, add this line to the task prompt, with
the main folder and the branch filled in: You are in a git worktree of <main
folder>. Merge into develop from the main folder with git -C <main folder>
merge --ff-only <branch>. If the main folder is not on develop or the
fast-forward fails, stop and say the branch is ready to merge.

At the cap of 4, \`fresh: true\` is refused and lists the sessions. Ask the user
which one to close, and call \`jarvis_close\` only on their word.

A \`trustPrompt\` in a send result means nothing was sent. Ask the user, call
\`jarvis_trust\` with their answer and the \`session\`, then send again with that
\`session\`.

## Scratch

A short answer you can give from what you already know stays with you.
Anything that needs files, the web, code, or more than a short spoken answer
goes to the \`Scratch\` workspace with \`fresh: true\`, one fresh session per
unrelated job. Scratch jobs get no note lookup.

## Note lookup

Before every project task, to-do or not, ask the vault workspace first. Find it
in \`jarvis_list\` as the workspace with \`kind: vault\`, never by name. Send to
its session labelled with the project name (\`jarvis_launch\` with
\`label: <project>\` if there is none yet). One lookup covers a whole batch for
one project. The prompt, with the task line(s) copied in verbatim:

Note lookup for: <task line(s)>. Using your own CLAUDE.md search rules, find the daily notes and wiki pages related to this task. Answer in at most 10 lines, each a fact plus the note path it came from. Answer "nothing relevant" if nothing is.

End that turn with one sentence, such as "Asked the vault about the
Working-section task." When its finish wakes you, do not summarise it aloud:
send the project task, routed as above, with the pipeline prompt
followed by \`Notes context:\` and the vault's answer verbatim. Skip that block
when the answer is "nothing relevant", the lookup failed, or there is no vault
workspace.

## Tools

- \`jarvis_watch\` — take the next finish off the queue, or park until one
  arrives. This is how a nudged turn reads what happened. It names the
  \`workspace\` and the \`session\`.
- \`jarvis_list\` — every live session (one row each, with its \`session\` label
  and \`worktree\`) and every workspace with none. For a question about the
  whole fleet, never for a finish summary.
- \`jarvis_send\` — write a prompt into a session of another workspace. With
  \`fresh: true\` it opens a new session and sends there; \`session: "main"\`
  sends to a code project's main tab.
  Confirm a send in a few words: the finish turn reports the result.
- \`jarvis_launch\` — open a new session for a workspace, with an optional
  \`label\`. The label \`main\` opens a code project's main-folder session.
- \`jarvis_close\` — close a session the user named. Refused while it is
  working, asking or blocked.
- \`jarvis_trust\` — answer a new session's folder-trust prompt with the
  user's own answer, after asking them.
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
  "alone, in as few words as possible: start with the workspace name and its " +
  "tab, read from the topic field when there is one, else the session " +
  'field ("main" for the main tab), as in "JARVIS review", then the single most ' +
  "important thing it did or needs. One spoken sentence if it fits, two at " +
  "most. If it finished a build, say what was built and what the user " +
  "should check by hand, three sentences at most. No preamble, no list, no file names, no markdown. Ignore every other " +
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

/** Empties Claude Code's composer: Ctrl+U and Ctrl+K kill the line on both
 * sides of the cursor, and Backspace or Ctrl+K at an empty line joins the
 * next line, so each round removes a line wherever the cursor sits. Only
 * editing keys: Esc and Ctrl+C would interrupt a running turn or cancel a
 * permission prompt, and the dialog ignores these. The kills chain, so the
 * user gets a cleared draft back with Ctrl+Y.
 * ponytail: 10 rounds clear a draft of about 20 lines. The TUI reads a chunk
 * of 120 bytes as a paste and drops the keys, and 60 failed once, so the
 * chunk stays at 30. */
export const CLEAR_INPUT = "\x15\x0b\x7f".repeat(10);

/** Writes that land together arrive as one chunk, which the TUI reads as a
 * paste: the keys stop editing and a CR lands as a newline instead of
 * submitting. The clear gets the wider gap because a paste that swallows it
 * also swallows the Enter after it. */
export const CLEAR_GAP_MS = 250;
export const SUBMIT_GAP_MS = 80;

/** Types a nudge into the main agent's session as clear, text, Enter — three
 * separate writes. False when there is no session to type into. */
export function typeNudge(
  write: (data: string) => boolean,
  text: string,
): boolean {
  if (!write(CLEAR_INPUT)) return false;
  setTimeout(() => {
    if (write(text)) setTimeout(() => write("\r"), SUBMIT_GAP_MS);
  }, CLEAR_GAP_MS);
  return true;
}

/** How long jarvis_launch waits for a new session to go quiet before it
 * answers anyway. Kept under the abort bound mcp.mjs gives that route. */
export const LAUNCH_SETTLE_DEADLINE_MS = 20_000;

/** The prompt the main agent hands to the vault workspace: fixed text plus
 * absolute paths — one note per machine that wrote that day — so the app
 * still composes nothing about the work. The answer is read as text; the main
 * agent's finish summary is what gets spoken. */
export const dailyBriefPrompt = (notePaths: string[]): string =>
  "Daily briefing. Read these files and nothing else: " +
  notePaths.join(", ") +
  ". They are the same day's notes, one per machine. Their filenames carry " +
  "the date — if it is not yesterday's, say which day it is from. Then write " +
  "one summary across all of them, with one paragraph per project they " +
  "mention: what moved, and what is still open. Say nothing about a project " +
  "they do not mention.";

/** Typed into the main agent's session on the first launch of a day. The
 * main agent delegates the note to `workspace` — the vault workspace — rather
 * than reading it itself, so the summary comes back through the ordinary
 * finish nudge. It carries the delegate's prompt verbatim, so the agent
 * forwards the wording rules instead of paraphrasing them. */
export const dailyBriefNudge = (
  notePaths: string[],
  workspace: string,
): string =>
  "Daily briefing. Do not read the notes yourself. Delegate them to the " +
  workspace +
  " workspace: if jarvis_list shows it has no session, call jarvis_launch " +
  "for it first, then call jarvis_send to " +
  workspace +
  " with exactly this prompt: " +
  dailyBriefPrompt(notePaths) +
  " Then stop; you will be woken when it finishes.";

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
