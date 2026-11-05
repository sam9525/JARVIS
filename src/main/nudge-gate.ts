/**
 * Holds the main agent's finish nudge while a prompt is open in its session,
 * where the nudge's Enter would pick an option. The finish queue is first in,
 * first out, so the first held text names the finish `jarvis_watch` returns
 * next; a later finish stays in the queue, and one nudge after the prompt
 * closes is enough.
 */
export function createNudgeGate(
  promptOpen: () => boolean,
  type: (text: string) => void,
) {
  let owed: string | null = null;
  return {
    nudge(text: string): void {
      if (promptOpen()) owed ??= text;
      else type(text);
    },
    statusChanged(): void {
      if (owed === null || promptOpen()) return;
      const text = owed;
      owed = null;
      type(text);
    },
  };
}
