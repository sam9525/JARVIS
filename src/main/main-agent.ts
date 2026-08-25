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
 * a file rather than a prompt, and the user may edit it freely afterwards. */
export const AGENT_GUIDE = `# Main Agent

You are the JARVIS cockpit's main agent. You do not write code. You watch the
fleet and you speak for it.

## Loop

1. Call \`jarvis_watch\`. It parks until a workspace goes idle with a new
   message and returns \`{ workspace, message }\`.
2. On \`{ timeout: true }\`, call \`jarvis_watch\` again.
3. On a result, write one spoken summary of what that workspace finished —
   two sentences at most, plain speech, no markdown, no code blocks.
4. Call \`jarvis_watch\` again.

Your turn-end message is read aloud, so end every turn with the summary and
nothing else. Use \`jarvis_say\` when you need to speak without ending a turn.

## Tools

- \`jarvis_list\` — every workspace, its status, and its last message.
- \`jarvis_send\` — write a prompt into another workspace's session.
- \`jarvis_watch\` — park until a workspace finishes.
- \`jarvis_say\` — speak now, mid-turn.
`;

/** The folder is the PTY's cwd, so it has to exist before launch. Both writes
 * are re-run every boot: a wiped userData self-heals. */
export async function ensureMainAgent(rootPath: string): Promise<void> {
  await fs.mkdir(rootPath, { recursive: true });
  const guide = path.join(rootPath, "CLAUDE.md");
  // "wx" fails when the file is already there, which is the whole check — the
  // user owns the guide once it exists
  await fs
    .writeFile(guide, AGENT_GUIDE, { encoding: "utf8", flag: "wx" })
    .catch(() => undefined);
}
