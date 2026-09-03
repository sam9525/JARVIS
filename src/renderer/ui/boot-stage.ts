// The entrance stagger's clock. Pure part first: the hook below is only a
// timer around it, so every ordering rule stays testable without a DOM.

/** gap between two stages opening, so two signals in one tick read as a sequence */
export const STEP_MS = 120;
/** longest a stage waits for its own signal before opening anyway */
export const FALLBACK_MS = 1200;

/**
 * The highest stage that should be open, given the highest already open and
 * the current signals. `-1` means nothing is open; section n is gated on
 * `stage >= n`.
 *
 * Never decreases, so a signal that flips back to false — a graph cleared, a
 * workspace list momentarily empty — cannot close a section already open.
 */
export function nextStage(stage: number, signals: boolean[]): number {
  let n = stage;
  while (n + 1 < signals.length && signals[n + 1]) n++;
  return n;
}
