// Wires tracker → gesture engine → whichever view registered actions. The
// camera belongs to `cameraOn` (App state, persisted as Settings.handControl);
// armed/disarmed belongs to this hook and is session-only. A tracker failure
// surfaces as `error` and stops this session's camera via onCameraFailed —
// never by rewriting the user's setting (design §3).
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { GestureEngine, type GestureEvent } from "./gestures";
import { startHandTracker } from "./hand-tracker";
import type { HandActions } from "./use-hand-actions";

export function useHandControl(opts: {
  cameraOn: boolean;
  actionsRef: MutableRefObject<HandActions>;
  onCameraFailed: () => void;
}): { armed: boolean; error: string | null } {
  const { cameraOn, actionsRef, onCameraFailed } = opts;
  const [armed, setArmed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const armedRef = useRef(true);
  const failedRef = useRef(onCameraFailed);
  failedRef.current = onCameraFailed;

  useEffect(() => {
    if (!cameraOn) return;
    // every camera start begins armed: letting a disarm survive an off→on
    // cycle would leave a live camera that ignores every gesture, escapable
    // only by a gesture the user has no reason to know about (design §3)
    armedRef.current = true;
    setArmed(true);
    setError(null);
    let cancelled = false;
    let stop: (() => void) | null = null;
    const engine = new GestureEngine();
    const apply = (ev: GestureEvent) => {
      if (ev.type === "arm") {
        armedRef.current = true;
        setArmed(true);
        return;
      }
      // disarmed drops everything except arm — the engine stays pure and
      // "disarmed" is this one line of gating (design §3)
      if (!armedRef.current) return;
      if (ev.type === "disarm") {
        armedRef.current = false;
        setArmed(false);
        return;
      }
      const a = actionsRef.current;
      if (ev.type === "drag") a.drag?.(ev.dx, ev.dy);
      else if (ev.type === "snap") a.snap?.();
      else if (ev.type === "step") a.step?.(ev.dir);
      else if (ev.type === "open") a.open?.();
      else if (ev.type === "orbit") a.orbit?.(ev.v);
      else if (ev.type === "zoom") a.zoom?.(ev.factor);
    };
    startHandTracker((f) => {
      engine.update(f.hand, f.t, f.second).forEach(apply);
      // tuning window: every threshold in gestures.ts is a guess until it is
      // checked against a real hand. In devtools:
      //   setInterval(() => console.log(window.__hands), 200)
      (window as unknown as { __hands: unknown }).__hands = engine.debug;
    })
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        failedRef.current();
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [cameraOn, actionsRef]);

  return { armed, error };
}
