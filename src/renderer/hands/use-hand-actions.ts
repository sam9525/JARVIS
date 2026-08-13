// Register a view's gesture action map for as long as the view is mounted.
// Assignment happens during render, not in a mount effect: actions close over
// live render state (Ring's `open` reads workspaces[centeredIndex], which
// changes on every rotation frame) and a mount-only write would freeze it.
// The ref is never read during render, so a torn write cannot be observed
// (design §4).
import { useEffect, useRef, type MutableRefObject } from "react";

export type HandActions = {
  drag?(dx: number, dy: number): void; // normalized hand units; sign matches pointer
  snap?(): void;
  step?(dir: 1 | -1): void;
  open?(): void;
  orbit?(v: number): void; // signed rad/s, dead-zoned + clamped
  zoom?(factor: number): void; // per-frame multiplicative ratio
  cursor?(x: number, y: number): void; // normalized 0..1 frame coords
};

/**
 * `enabled: false` registers nothing and owns nothing, for a caller whose view
 * is not the one on screen. It writes no map at all rather than an empty one:
 * the ref is shared, so writing `{}` would clobber the real owner and only be
 * undone if that owner re-rendered in the same pass — leaving every gesture
 * dispatching into `{}` on any render where it didn't.
 */
export function useHandActions(
  ref: MutableRefObject<HandActions>,
  actions: HandActions,
  enabled = true,
): void {
  const mine = useRef(actions);
  if (enabled) {
    mine.current = actions;
    ref.current = actions;
  }
  // React renders the incoming view before running the outgoing view's
  // cleanup, so an unconditional clear here would wipe the map of the view
  // that just took over. Clear only what we still own — commit ordering, not
  // concurrency: exactly one graph view is ever mounted (design §4).
  useEffect(() => {
    return () => {
      if (ref.current === mine.current) ref.current = {};
    };
  }, []);
}
