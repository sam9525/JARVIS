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
};

export function useHandActions(
  ref: MutableRefObject<HandActions>,
  actions: HandActions,
): void {
  const mine = useRef(actions);
  mine.current = actions;
  ref.current = actions;
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
