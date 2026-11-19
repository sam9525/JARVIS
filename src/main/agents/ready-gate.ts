export type ReadyState = "starting" | "ready" | "used";

/** Tracks each gated (non-Claude) session's turn: `starting` until its first hook, `ready`
 * while no prompt of its own is in progress, `used` once a prompt is submitted.
 * An Interrupt ends the turn, so it makes a used session ready again. */
export function createReadyGate() {
  const states = new Map<string, ReadyState>();

  return {
    open(key: string): void {
      states.set(key, "starting");
    },

    note(key: string, hookEventName: string): void {
      const current = states.get(key);
      if (current === undefined) return;
      if (current === "used") {
        if (hookEventName === "Interrupt") states.set(key, "ready");
        return;
      }
      if (hookEventName === "UserPromptSubmit") states.set(key, "used");
      else if (current === "starting") states.set(key, "ready");
    },

    state(key: string): ReadyState | undefined {
      return states.get(key);
    },

    forget(key: string): void {
      states.delete(key);
    },
  };
}
