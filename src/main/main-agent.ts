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
