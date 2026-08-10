import { useCallback, useRef } from "react";
import type React from "react";
import type { PanelState } from "../../shared/types";
import { movePanel, resizePanel, snapToEdges } from "./panel-layout";

const viewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

/**
 * Pointer drag for the title bar and the bottom-right grip. Deltas are applied
 * against the state captured at pointerdown, so a fast drag that outruns React
 * cannot compound rounding error; the snap lands once, on release.
 */
export function usePanelDrag(opts: {
  state: PanelState;
  onChange(next: PanelState): void;
}): {
  onTitlePointerDown(e: React.PointerEvent): void;
  onGripPointerDown(e: React.PointerEvent): void;
} {
  const latest = useRef(opts);
  latest.current = opts;

  const begin = useCallback(
    (e: React.PointerEvent, mode: "move" | "resize") => {
      e.preventDefault();
      e.stopPropagation();
      const start = latest.current.state;
      const sx = e.clientX;
      const sy = e.clientY;
      const apply = (ev: PointerEvent) => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        latest.current.onChange(
          mode === "move"
            ? movePanel(start, dx, dy, viewport())
            : resizePanel(start, dx, dy, viewport()),
        );
      };
      const up = (ev: PointerEvent) => {
        apply(ev);
        if (mode === "move")
          latest.current.onChange(
            snapToEdges(latest.current.state, viewport()),
          );
        window.removeEventListener("pointermove", apply);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", apply);
      window.addEventListener("pointerup", up);
    },
    [],
  );

  return {
    onTitlePointerDown: useCallback((e) => begin(e, "move"), [begin]),
    onGripPointerDown: useCallback((e) => begin(e, "resize"), [begin]),
  };
}
