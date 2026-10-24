export interface SessionInfo {
  key: string;
  workspaceId: string;
  label: string;
  cwd: string;
  worktree: boolean;
}

export type Reservation = Pick<SessionInfo, "key" | "workspaceId" | "label">;

/** Every session JARVIS launched and has not closed, live or exited: a
 * session that ended on its own keeps its entry, so closing its tab still
 * finds the worktree to remove. A reservation holds a key while its launch is
 * still awaiting, so a second launch started meanwhile sees its label and
 * counts it against the cap. */
export function createSessionRegistry() {
  const sessions = new Map<string, SessionInfo>();
  const reservations = new Map<string, Reservation>();
  return {
    reserve(r: Reservation): boolean {
      if (reservations.has(r.key)) return false;
      reservations.set(r.key, r);
      return true;
    },
    release(key: string): void {
      reservations.delete(key);
    },
    reserved(workspaceId: string): Reservation[] {
      return [...reservations.values()].filter(
        (r) => r.workspaceId === workspaceId,
      );
    },
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
