import { useEffect, useRef, useState } from "react";

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

/**
 * Opens stage n when `signals[n]` is true, or when FALLBACK_MS has elapsed
 * waiting for it, whichever comes first. Stages are separated by STEP_MS so
 * two signals arriving in one tick still read as a sequence, not a flash.
 *
 * `signals` is a fresh array every render, so it is never an effect dep — the
 * deps are the three scalars derived from it.
 */
export function useBootStage(signals: boolean[]): number {
  const [stage, setStage] = useState(-1);
  // read inside the timer, so a signal that turns true while a stage is
  // waiting still opens every stage it has earned
  const latest = useRef(signals);
  latest.current = signals;

  const done = stage >= signals.length - 1;
  const ready = !done && signals[stage + 1] === true;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(
      // always at least one more stage: that is the fallback. More when the
      // signals below it are already true.
      () => setStage((s) => Math.max(s + 1, nextStage(s, latest.current))),
      ready ? STEP_MS : FALLBACK_MS,
    );
    return () => clearTimeout(t);
  }, [stage, ready, done]);

  return stage;
}
