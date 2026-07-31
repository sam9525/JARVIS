// Wires tracker → gesture engine → ring actions. Owns the toggle: off by
// default, camera stops on toggle-off, fist-off event, or unmount. A tracker
// failure surfaces as `error` and can never break the ring (design §6).
import { useEffect, useRef, useState } from "react";
import { GestureEngine, type GestureEvent } from "./gestures";
import { startHandTracker } from "./hand-tracker";

export type HandActions = {
  rotate(dx: number): void; // normalized hand units, sign matches pointer dx
  snap(): void;
  step(dir: 1 | -1): void;
  open(): void;
};

export function useHandControl(actions: HandActions): {
  enabled: boolean;
  error: string | null;
  toggle(): void;
} {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ref keeps the effect off the render loop while callbacks stay fresh
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    const engine = new GestureEngine();
    const apply = (ev: GestureEvent) => {
      const a = actionsRef.current;
      if (ev.type === "drag") a.rotate(ev.dx);
      else if (ev.type === "snap") a.snap();
      else if (ev.type === "step") a.step(ev.dir);
      else if (ev.type === "open") a.open();
      else setEnabled(false); // fist held — hand control off
    };
    startHandTracker((f) => engine.update(f.hand, f.t).forEach(apply))
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setEnabled(false);
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [enabled]);

  return {
    enabled,
    error,
    toggle: () => {
      setError(null);
      setEnabled((v) => !v);
    },
  };
}
