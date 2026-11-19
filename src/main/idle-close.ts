import type { SessionInfo } from "./sessions";
import type { Workspace } from "../shared/types";

// ponytail: env override exists only to test the close live without waiting
export const IDLE_CLOSE_MS =
  Number(process.env.JARVIS_IDLE_CLOSE_MS) || 30 * 60 * 1000;

/** Keys of live sessions the orchestrator launched, in non-main-agent
 * workspaces. A hand-opened tab and a session without a terminal are left
 * alone. A session whose delivered prompt has not run yet is left open. */
export function idleCloseKeys(
  workspaces: Workspace[],
  sessionsOf: (workspaceId: string) => SessionInfo[],
  hasPty: (key: string) => boolean,
  unconfirmed: (key: string) => boolean,
): string[] {
  return workspaces
    .filter((w) => !w.isSelf)
    .flatMap((w) => sessionsOf(w.id))
    .filter((s) => s.delegated && hasPty(s.key) && !unconfirmed(s.key))
    .map((s) => s.key);
}

export interface IdleCloseDeps {
  /** Live delegated sessions; never the main agent or a hand-opened tab. */
  keys(): string[];
  msSinceOutput(key: string): number;
  /** True for a worktree holding uncommitted or unmerged work. */
  keepsWork(key: string): Promise<boolean>;
  /** Refuses a busy, asking or blocked session, or one with a draft. */
  closeIfIdle(key: string): Promise<boolean>;
}

/** Closes every session whose terminal has been silent for `idleMs`. */
export async function closeQuietSessions(
  deps: IdleCloseDeps,
  idleMs = IDLE_CLOSE_MS,
): Promise<string[]> {
  const closed: string[] = [];
  for (const key of deps.keys()) {
    if (deps.msSinceOutput(key) < idleMs) continue;
    if (await deps.keepsWork(key)) continue;
    if (await deps.closeIfIdle(key)) closed.push(key);
  }
  return closed;
}
