import React from "react";
import type { PanelId, PanelState } from "../../shared/types";
import { CAPBAR, FRAME, FRAME_DIM, LBL_CY, LBL_DIM, panelClass } from "./hud";
import { TITLE_BAR_H } from "./panel-layout";
import { usePanelDrag } from "./use-panel-drag";

type PanelProps = {
  id: PanelId;
  title: string;
  badge?: React.ReactNode;
  state: PanelState;
  focused: boolean;
  hidden?: boolean;
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
  onChange,
  onFocus,
  onClose,
  children,
}: PanelProps) {
  const drag = usePanelDrag({ state, onChange });
  // clear-the-deck: unmounting is deliberate — a hidden terminal keeps its
  // xterm instance in the module-level map either way, so nothing is lost
  if (hidden) return null;
  const height = state.collapsed ? TITLE_BAR_H : state.h;
  return (
    <div
      data-testid={`panel-${id}`}
      className={"absolute " + panelClass(focused)}
      style={{
        left: state.x,
        top: state.y,
        width: state.w,
        height,
        zIndex: state.z,
      }}
      onPointerDown={onFocus}
    >
      <div className={CAPBAR} onPointerDown={drag.onTitlePointerDown}>
        <span className={focused ? LBL_CY : LBL_DIM}>⣿&nbsp;&nbsp;{title}</span>
        <span className="flex items-center gap-2">
          {badge}
          <button
            data-testid={`panel-collapse-${id}`}
            title={state.collapsed ? "Expand" : "Collapse"}
            className="cursor-pointer text-[10px] text-ink-dim hover:text-accent"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onChange({ ...state, collapsed: !state.collapsed })}
          >
            {state.collapsed ? "▸" : "▾"}
          </button>
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
      {!state.collapsed && (
        <>
          <div
            className="min-h-0 overflow-hidden"
            style={{ height: state.h - TITLE_BAR_H }}
          >
            {children}
          </div>
          <div
            data-testid={`panel-grip-${id}`}
            className="absolute right-0.5 bottom-0.5 h-2.5 w-2.5 cursor-nwse-resize border-r border-b border-accent"
            onPointerDown={drag.onGripPointerDown}
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
