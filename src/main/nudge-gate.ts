/**
 * Holds the main agent's finish nudge while a prompt is open in its session,
 * where the nudge's Enter would pick an option. The finish stays in the queue
 * either way, so one nudge after the prompt closes is enough.
 */
export function createNudgeGate(promptOpen: () => boolean, type: () => void) {
  let owed = false;
  return {
    nudge(): void {
      if (promptOpen()) owed = true;
      else type();
    },
    statusChanged(): void {
      if (!owed || promptOpen()) return;
      owed = false;
      type();
    },
  };
}
