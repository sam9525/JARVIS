import { useEffect, useState } from "react";

// The entrance stagger's clock.

/** one boot-in / boot-fade / boot-frame, matching their duration in index.css */
export const ENTER_MS = 480;
/** gap between two items entering inside one stage — rail buttons, cards */
export const LIST_STEP_MS = 60;
/** longest a stage waits for its own signal before opening anyway */
export const FALLBACK_MS = 1200;

/** how long a staggered run of `items` takes from its first frame to its last */
export const runMs = (items: number) =>
  Math.max(items - 1, 0) * LIST_STEP_MS + ENTER_MS;

/**
 * The highest stage that should be open: `-1` means nothing is open, and
 * section n is gated on `stage >= n`.
 *
 * `holds[n]` is how long stage n's own entrance runs, so a stage opens only
 * once the one before it has finished animating — a six-button rail holds the
 * graph slot for its whole 620 ms run, not for a fixed beat. Nothing is
 * animating before stage 0, so it opens as soon as its signal lands.
 *
 * One stage per tick, always. Opening every ready stage at once would land
 * their classes in one commit, which is the flash the hold exists to prevent.
 * The stage therefore only ever climbs, and only ever by one, so a signal that
 * flips back to false — a graph cleared, a workspace list momentarily empty —
 * cannot close a section already open, and no section can open before the one
 * above it.
 */
export function useBootStage(signals: boolean[], holds: number[]): number {
  const [stage, setStage] = useState(-1);
  // Reduced motion opens everything at once. Cancelling the animations alone
  // would leave the holds — they are timers, not animations — so the window
  // would sit near-empty for a second or two and then pop four times. Worse,
  // the sections wait behind `visibility: hidden`, which keeps them out of the
  // focus order and the accessibility tree for that whole stretch.
  const [reduced] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const done = reduced || stage >= signals.length - 1;
  const ready = !done && signals[stage + 1] === true;
  const hold = stage < 0 ? 0 : (holds[stage] ?? ENTER_MS);

  useEffect(() => {
    if (done) return;
    // a signal turning true mid-wait re-runs this through `ready`, which swaps
    // the stall backstop for the hold. The backstop never cuts a run short:
    // a long enough list outlasts FALLBACK_MS on its own.
    const t = setTimeout(
      () => setStage((s) => s + 1),
      ready ? hold : Math.max(FALLBACK_MS, hold),
    );
    return () => clearTimeout(t);
  }, [stage, ready, done, hold]);

  return reduced ? signals.length - 1 : stage;
}
