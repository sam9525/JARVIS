import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import type { PanelState } from "../../shared/types";
import { movePanel, resizePanel, snapToEdges } from "./panel-layout";
import type { ResizeEdge } from "./panel-layout";

export const viewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

/**
 * Pointer drag for the title bar and the bottom-right grip. Every position is
 * computed from the state captured at pointerdown, so a fast drag that outruns
 * React cannot compound rounding error.
 */
export function usePanelDrag(opts: {
  state: PanelState;
  onChange(next: PanelState): void;
}): {
  onTitlePointerDown(e: React.PointerEvent): void;
  onGripPointerDown(e: React.PointerEvent, edge?: ResizeEdge): void;
} {
  const latest = useRef(opts);
  latest.current = opts;
  // A drag interrupted by unmount — clear-the-deck flipping `hidden`, a
  // workspace switch — would otherwise leave window listeners bound to a dead
  // closure, and a later unrelated pointerup would fire it and jump the panel
  // from a stale origin.
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const begin = useCallback(
    (e: React.PointerEvent, mode: "move" | ResizeEdge) => {
      e.preventDefault();
      e.stopPropagation();
      stopRef.current?.(); // a second pointerdown must not stack listeners
      const start = latest.current.state;
      const sx = e.clientX;
      const sy = e.clientY;
      const at = (ev: PointerEvent): PanelState => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        return mode === "move"
          ? movePanel(start, dx, dy, viewport())
          : resizePanel(start, dx, dy, viewport(), mode);
      };
      const move = (ev: PointerEvent) => latest.current.onChange(at(ev));
      const finish = (ev: PointerEvent) => {
        // Snap the position THIS event produces. Reading `latest.current.state`
        // here reads one render behind: onChange only schedules an update, and
        // React does not flush it inside a native window handler — so the last
        // movement before release would be silently discarded.
        const final = at(ev);
        latest.current.onChange(
          mode === "move" ? snapToEdges(final, viewport()) : final,
        );
        stop();
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", stop);
        stopRef.current = null;
      };
      stopRef.current = stop;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", stop);
    },
    [],
  );

  return {
    onTitlePointerDown: useCallback((e) => begin(e, "move"), [begin]),
    onGripPointerDown: useCallback(
      (e, edge: ResizeEdge = "se") => begin(e, edge),
      [begin],
    ),
  };
}
