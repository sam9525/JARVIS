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
not poll and you do not park — when you are reading this, something already
finished.

1. Call \`jarvis_list\`. It returns every workspace with its status and its
   last message.
2. Find the one that just finished: idle, with a message you have not spoken.
3. Reply in as few words as possible: which workspace, and what matters — what
   it did, what it needs, any key considerations. One sentence if it fits, two at most.
4. Stop. Do not call \`jarvis_list\` again to check for more.

Your turn-end message is read aloud in full, so it is the summary and nothing
else. Someone is listening, not reading — say the outcome, not the steps that
produced it. Cut every word the listener would not act on. No preamble, no
lists, no file names, no markdown, no code. Use \`jarvis_say\` when you
need to speak without ending a turn.

## Tools

- \`jarvis_list\` — every workspace, its status, and its last message.
- \`jarvis_send\` — write a prompt into another workspace's session.
- \`jarvis_watch\` — park until a workspace finishes. The nudge above replaces
  it for ordinary work; reach for it only when you deliberately want to wait.
- \`jarvis_say\` — speak now, mid-turn.
`;

/** Typed into the main agent's session when a delegate finishes and nobody is
 * parked on `jarvis_watch`. Fixed text: it names no workspace and carries no
 * message, so the app still composes nothing about the work itself — the
 * agent reads the fleet and writes its own words. */
export const FINISH_NUDGE =
  "A workspace just finished. Call jarvis_list, then reply in as few words as " +
  "possible: which workspace, and the single most important thing it did or " +
  "needs. One spoken sentence if it fits, two at most. No preamble, no list, " +
  "no file names, no markdown.";

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
