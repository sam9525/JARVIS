export interface SessionInfo {
  key: string;
  workspaceId: string;
  label: string;
  cwd: string;
  worktree: boolean;
}

/** Every session JARVIS launched and has not closed, live or exited: a
 * session that ended on its own keeps its entry, so closing its tab still
 * finds the worktree to remove. */
export function createSessionRegistry() {
  const sessions = new Map<string, SessionInfo>();
  return {
    add(s: SessionInfo): void {
      sessions.set(s.key, s);
    },
    remove(key: string): SessionInfo | undefined {
      const s = sessions.get(key);
      sessions.delete(key);
      return s;
    },
    get(key: string): SessionInfo | undefined {
      return sessions.get(key);
    },
    forWorkspace(workspaceId: string): SessionInfo[] {
      return [...sessions.values()].filter(
        (s) => s.workspaceId === workspaceId,
      );
    },
  };
}
