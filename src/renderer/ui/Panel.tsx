import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PanelId, PanelState } from "../../shared/types";
import { CAPBAR, FRAME, LBL_CY, panelClass } from "./hud";
import {
  type Box,
  clampToViewport,
  MIN_H,
  TITLE_BAR_H,
  type ResizeEdge,
} from "./panel-layout";
import { usePanelDrag, viewport } from "./use-panel-drag";

/** .panel-out's duration in index.css — the two have to agree */
export const PANEL_OUT_MS = 220;
/** .panel-fold's transition duration in index.css — likewise */
export const FOLD_MS = 220;

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
   * Whether the owner wants this panel on screen. Omitted means yes — a panel
   * the owner mounts and unmounts itself. Pass it (and render the Panel
   * unconditionally) when a control outside the title bar closes the panel, so
   * the exit has something left to play on.
   */
  open?: boolean;
  /**
   * Collapse to this width, keeping the body, instead of to the title bar.
   * Home's terminal uses it to shrink to an inbox strip — the fleet's state is
   * the one thing worth keeping on screen while the session itself is out of
   * the way. It narrows from the left and shrink-wraps its content, so a
   * right-docked panel stays docked and covers only what it still shows.
   */
  compactWidth?: number;
  /**
   * Which edge a fold holds still, so a docked panel stays docked. Right by
   * default — the terminal and settings dock right and shrink leftward. Preview
   * opens from the left, so it folds back the other way.
   */
  foldTo?: "left" | "right";
  /**
   * An entrance animation class merged into the root. A prop rather than a
   * wrapper: a wrapper carrying a transform becomes the containing block for
   * this absolutely-positioned root, so the inline left/top would resolve
   * against the wrapper until the transform cleared, then jump.
   */
  enterClass?: string;
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
  open,
  compactWidth,
  foldTo = "right",
  enterClass,
  onChange,
  onFocus,
  onClose,
  children,
}: PanelProps) {
  // Every way out plays the same exit, and the panel stays on screen while it
  // runs: ✕ hands the unmount to the owner at the end, and `hidden` (the deck)
  // or `open === false` (the ⚙ toggling its own panel shut) drop to null here.
  // `gone` is what ends those two — the prop that closed them stays set, so
  // there is nothing else to say the exit is over.
  //
  // `open` is why the owner renders this unconditionally rather than behind a
  // `&&`: a panel React has already unmounted has no exit left to play.
  //
  // A timer rather than `animationend`: that event never fires if the animation
  // is interrupted or switched off, and a panel that missed its own close stays
  // on screen for good. The cost is this number agreeing with .panel-out in
  // index.css, which is the same trade ENTER_MS already makes.
  const [closing, setClosing] = useState(false);
  const [gone, setGone] = useState(open === false);
  const leaving = closing || !!hidden || open === false;
  // The owner passes `onClose` as an inline arrow, so it is a new identity on
  // every one of its renders. Read through a ref instead of depending on it: as
  // a dep it would clear and re-arm the exit timer each render, and an owner
  // that re-renders faster than PANEL_OUT_MS would never let it fire.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!leaving) {
      setGone(false); // it came back: this panel may enter again
      return;
    }
    if (gone) return; // the exit already ran; `open === false` keeps `leaving` up
    const t = setTimeout(() => {
      // `closing` is what says ✕ started this rather than the owner, and it has
      // to be dropped here: an instance the owner keeps mounted — the settings
      // panel — would otherwise hold `leaving` true for good and never reopen.
      if (closing) {
        setClosing(false);
        onCloseRef.current?.();
      }
      setGone(true);
    }, PANEL_OUT_MS);
    return () => clearTimeout(t);
  }, [leaving, closing, gone]);

  // Folding animates the box; a drag or a resize must not, or it lags the
  // pointer by the transition's whole duration. So the transition is armed for
  // the fold alone, and only for as long as the fold takes.
  //
  // Armed during render, not in an effect. An effect runs after the commit that
  // already changed the height, so the class would land a frame late — with the
  // property at its new value and nothing left to transition, which is a fold
  // that snaps. Comparing against a state copy of the last value is React's own
  // way to derive state from props mid-render: the re-render happens before the
  // browser sees either change, so the class and the new geometry land together.
  //
  // `foldSeq` counts folds rather than tracking a boolean, so a second fold
  // started inside the first one's window restarts the timer. On `[folding]`
  // alone the dep never changed, and the first timer stripped the class partway
  // through the second fold — which then snapped.
  const [folding, setFolding] = useState(false);
  const [foldSeq, setFoldSeq] = useState(0);
  const [wasCollapsed, setWasCollapsed] = useState(state.collapsed);
  if (wasCollapsed !== state.collapsed) {
    setWasCollapsed(state.collapsed);
    setFolding(true);
    setFoldSeq((n) => n + 1);
  }
  useEffect(() => {
    if (!folding) return;
    const t = setTimeout(() => setFolding(false), FOLD_MS);
    return () => clearTimeout(t);
  }, [folding, foldSeq]);

  const compact = state.collapsed && compactWidth !== undefined;
  const width = compact ? compactWidth : state.collapsed ? undefined : state.w;
  // A minimized panel shrink-wraps to its title bar, so it is the only thing
  // that knows its own width. Everything else in the folded box is analytic:
  // compact is `compactWidth` wide, and a minimized panel is exactly one title
  // bar tall. MIN_H stands in for compact's shrink-wrapped height, which would
  // cost a second measurement to save ~100px of travel.
  const ref = useRef<HTMLDivElement>(null);
  const [barW, setBarW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !state.collapsed || compactWidth !== undefined) return;
    // runs on every render, so the equality bail-out is what stops the loop
    setBarW((w) => (w === el.offsetWidth ? w : el.offsetWidth));
  });
  // A collapsed panel's stored geometry still describes the box it expands back
  // to, so dragging it against that box clamps it against a width and height it
  // does not currently occupy — which pins a folded right-docked terminal in
  // place and stops it short of the bottom edge. Drag the folded box instead
  // and translate the result back, which is also what holds the fold against
  // the `foldTo` edge of the expanded box: a docked panel stays docked.
  const box: Box | undefined = !state.collapsed
    ? undefined
    : compact
      ? { w: compactWidth, h: MIN_H }
      : { w: barW || state.w, h: TITLE_BAR_H };
  const dx = box && foldTo === "right" ? state.w - box.w : 0;
  const drag = usePanelDrag({
    state: state.collapsed ? { ...state, x: state.x + dx } : state,
    box,
    onChange: state.collapsed
      ? (next) => onChange({ ...state, x: next.x - dx, y: next.y })
      : onChange,
  });
  // clear-the-deck: unmounting is deliberate — a hidden terminal keeps its
  // xterm instance in the module-level map either way, so nothing is lost. It
  // waits for the exit first; `gone` is set PANEL_OUT_MS after the prop went up.
  if (gone) return null;
  return (
    <div
      ref={ref}
      data-testid={`panel-${id}`}
      // a panel with no boot stage of its own just enters when it opens
      className={
        "absolute " +
        panelClass(focused) +
        " " +
        (leaving ? "panel-out" : (enterClass ?? "panel-in")) +
        (folding ? " panel-fold" : "")
      }
      style={{
        left: state.x + dx,
        top: state.y,
        width,
        // compact shrink-wraps its body; the rest is exactly as tall as its state
        height: compact ? undefined : state.collapsed ? TITLE_BAR_H : state.h,
        zIndex: state.z,
      }}
      // capture, not bubble: the title bar and every resize handle stop
      // propagation to claim the drag, so a bubbling handler here would raise
      // the panel on a body press but not on the grip you actually reach for
      onPointerDownCapture={onFocus}
    >
      <div className={CAPBAR} onPointerDown={drag.onTitlePointerDown}>
        {/* title and frame stay lit whatever has focus — a dimmed preview or
            settings panel read as disabled next to the terminal you were just
            typing in. Focus is still legible in the body fill (panelClass). */}
        <span className={LBL_CY}>⣿&nbsp;&nbsp;{title}</span>
        <span className="ml-3 flex items-center gap-2">
          {badge}
          <button
            data-testid={`panel-collapse-${id}`}
            title={state.collapsed ? "Expand" : "Minimize"}
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
          {onClose && (
            <button
              data-testid={`panel-close-${id}`}
              title="Close"
              className="cursor-pointer text-[10px] text-ink-dim hover:text-accent"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setClosing(true)}
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
      <div className={FRAME + " -inset-1.5"}>
        <span className="hud-c3" />
        <span className="hud-c4" />
      </div>
    </div>
  );
}
