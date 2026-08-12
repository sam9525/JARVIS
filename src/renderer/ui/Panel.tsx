import React from "react";
import type { PanelId, PanelState } from "../../shared/types";
import { CAPBAR, FRAME, FRAME_DIM, LBL_CY, LBL_DIM, panelClass } from "./hud";
import {
  clampToViewport,
  MIN_H,
  TITLE_BAR_H,
  type ResizeEdge,
} from "./panel-layout";
import { usePanelDrag, viewport } from "./use-panel-drag";

// Every border is a resize handle. The strips are invisible and sit outside the
// body's rounded corners, so the only visible affordance stays the SE grip.
const HANDLES: Array<[ResizeEdge, string]> = [
  ["n", "inset-x-2 top-0 h-1.5 cursor-ns-resize"],
  ["s", "inset-x-2 bottom-0 h-1.5 cursor-ns-resize"],
  ["w", "inset-y-2 left-0 w-1.5 cursor-ew-resize"],
  ["e", "inset-y-2 right-0 w-1.5 cursor-ew-resize"],
  ["nw", "top-0 left-0 h-2.5 w-2.5 cursor-nwse-resize"],
  ["ne", "top-0 right-0 h-2.5 w-2.5 cursor-nesw-resize"],
  ["sw", "bottom-0 left-0 h-2.5 w-2.5 cursor-nesw-resize"],
];

type PanelProps = {
  id: PanelId;
  title: string;
  badge?: React.ReactNode;
  state: PanelState;
  focused: boolean;
  hidden?: boolean;
  /**
   * Collapse to this width, keeping the body, instead of to the title bar.
   * Home's terminal uses it to shrink to an inbox strip — the fleet's state is
   * the one thing worth keeping on screen while the session itself is out of
   * the way. It narrows from the left and shrink-wraps its content, so a
   * right-docked panel stays docked and covers only what it still shows.
   */
  compactWidth?: number;
  /** off for a panel that closes instead of folding — see App's workspace terminal */
  collapsible?: boolean;
  onChange(next: PanelState): void;
  onFocus(): void;
  onClose?(): void;
  children: React.ReactNode;
};

// The floating-panel shell. Knows nothing about terminals, previews or
// settings — geometry comes from panel-layout, contents come from children.
export default function Panel({
  id,
  title,
  badge,
  state,
  focused,
  hidden,
  compactWidth,
  collapsible = true,
  onChange,
  onFocus,
  onClose,
  children,
}: PanelProps) {
  const compact = state.collapsed && compactWidth !== undefined;
  const width = compact ? compactWidth : state.w;
  const dx = compact ? state.w - compactWidth : 0;
  // A compact panel's stored geometry still describes the box it expands back
  // to, so dragging it against that box clamps it against a width and height
  // it does not currently occupy — which pins a full-height right-docked
  // terminal in place. Drag the box that is actually on screen instead, and
  // translate the result back. MIN_H stands in for the shrink-wrapped height;
  // measuring it would cost a ref and a re-render to save ~100px of travel.
  const drag = usePanelDrag({
    state: compact
      ? { ...state, x: state.x + dx, w: compactWidth, h: MIN_H }
      : state,
    onChange: compact
      ? (next) => onChange({ ...state, x: next.x - dx, y: next.y })
      : onChange,
  });
  // clear-the-deck: unmounting is deliberate — a hidden terminal keeps its
  // xterm instance in the module-level map either way, so nothing is lost
  if (hidden) return null;
  return (
    <div
      data-testid={`panel-${id}`}
      className={"absolute " + panelClass(focused)}
      style={{
        left: state.x + dx,
        top: state.y,
        width,
        // compact shrink-wraps its body; the rest is exactly as tall as its state
        height: compact ? undefined : state.collapsed ? TITLE_BAR_H : state.h,
        zIndex: state.z,
      }}
      onPointerDown={onFocus}
    >
      <div className={CAPBAR} onPointerDown={drag.onTitlePointerDown}>
        <span className={focused ? LBL_CY : LBL_DIM}>⣿&nbsp;&nbsp;{title}</span>
        <span className="flex items-center gap-2">
          {badge}
          {collapsible && (
            <button
              data-testid={`panel-collapse-${id}`}
              title={state.collapsed ? "Expand" : "Collapse"}
              className="cursor-pointer text-[10px] text-ink-dim hover:text-accent"
              onPointerDown={(e) => e.stopPropagation()}
              // expanding re-clamps: the small box may have been dragged
              // somewhere the full one does not fit
              onClick={() => {
                const next = { ...state, collapsed: !state.collapsed };
                onChange(
                  state.collapsed ? clampToViewport(next, viewport()) : next,
                );
              }}
            >
              {state.collapsed ? "▸" : "▾"}
            </button>
          )}
          {onClose && (
            <button
              data-testid={`panel-close-${id}`}
              title="Close"
              className="cursor-pointer text-[10px] text-ink-dim hover:text-accent"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
            >
              ✕
            </button>
          )}
        </span>
      </div>
      {(compact || !state.collapsed) && (
        <div
          className="min-h-0 overflow-hidden"
          // a compact body sizes to its content, but never past the height the
          // expanded panel had — anything longer scrolls inside itself
          style={
            compact
              ? { maxHeight: state.h - TITLE_BAR_H }
              : { height: state.h - TITLE_BAR_H }
          }
        >
          {children}
        </div>
      )}
      {/* a compact panel is a fixed size by definition — no grips */}
      {!state.collapsed && (
        <>
          {HANDLES.map(([edge, cls]) => (
            <div
              key={edge}
              data-testid={`panel-resize-${edge}-${id}`}
              className={"absolute " + cls}
              onPointerDown={(e) => drag.onGripPointerDown(e, edge)}
            />
          ))}
          <div
            data-testid={`panel-grip-${id}`}
            className="absolute right-0.5 bottom-0.5 h-2.5 w-2.5 cursor-nwse-resize border-r border-b border-accent"
            onPointerDown={(e) => drag.onGripPointerDown(e, "se")}
          />
        </>
      )}
      <div className={(focused ? FRAME : FRAME_DIM) + " -inset-1.5"}>
        <span className="hud-c3" />
        <span className="hud-c4" />
      </div>
    </div>
  );
}
