/** Waits for a PTY to go quiet. Claude Code drops text written before its TUI
 * enters raw mode, and a session that is still painting is not reading yet:
 * every chunk pushes the timer out, and `quietMs` of silence means the prompt
 * is ready. One waiter per workspace; a second wait replaces the first. */
export function createSettle(quietMs: number) {
  const waiters = new Map<
    string,
    {
      timer: ReturnType<typeof setTimeout> | null;
      done: (settled: boolean) => void;
    }
  >();

  return {
    bump(id: string): void {
      const w = waiters.get(id);
      if (!w) return;
      if (w.timer) clearTimeout(w.timer);
      w.timer = setTimeout(() => w.done(true), quietMs);
    },

    /** Resolves true after `quietMs` of silence that follows at least one
     * chunk, false if `deadlineMs` passes first. Call it before the launch:
     * output that arrives before the waiter exists starts no timer. */
    wait(id: string, deadlineMs: number): Promise<boolean> {
      waiters.get(id)?.done(false);
      return new Promise((resolve) => {
        const deadline = setTimeout(() => entry.done(false), deadlineMs);
        const entry = {
          timer: null as ReturnType<typeof setTimeout> | null,
          done: (settled: boolean) => {
            if (waiters.get(id) !== entry) return;
            waiters.delete(id);
            if (entry.timer) clearTimeout(entry.timer);
            clearTimeout(deadline);
            resolve(settled);
          },
        };
        waiters.set(id, entry);
      });
    },
  };
}
