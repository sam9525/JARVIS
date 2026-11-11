// ponytail: env override exists only to test the close live without waiting
export const IDLE_CLOSE_MS =
  Number(process.env.JARVIS_IDLE_CLOSE_MS) || 30 * 60 * 1000;

export interface IdleCloseDeps {
  /** Live delegate sessions; never the main agent. */
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
