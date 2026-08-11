import type { StatusKind } from "../../shared/types";

// The HUD skin, spelled once. Every bracket frame, glass panel and micro-label
// in the app composes from these strings — 40 hand-written className soups
// drift, one vocabulary does not.

/** corner-bracket frame; the element itself draws nothing but its corners */
export const FRAME = "pointer-events-none absolute hud-frame";
export const FRAME_DIM = FRAME + " hud-frame-dim";

/** panel body fills */
export const GLASS = "bg-panel/80 border border-accent/20";
export const GLASS_UN = "bg-panel/55 border border-accent/10";

/**
 * Micro-label: the HUD's only body type. LBL carries no colour on purpose. A
 * variant appending one on top of a baked-in `text-ink-dim` would ship two
 * text-colour utilities in a single class string, and which one wins is
 * decided by Tailwind's generated stylesheet order, not by position in the
 * string — so the variant would render correctly only by luck.
 */
export const LBL = "font-hud text-[9px] uppercase tracking-[0.22em]";
export const LBL_DIM = LBL + " text-ink-dim";
export const LBL_CY = LBL + " text-accent hud-bloom";
export const LBL_AM = LBL + " text-warm hud-bloom-warm";

export const CAPBAR =
  "flex items-center justify-between px-2.5 py-1 border-b border-accent/20 cursor-move select-none";

export const PIP =
  "flex h-[27px] w-[27px] items-center justify-center rounded-full border text-[9.5px] tracking-[0.1em] transition-colors";

/**
 * Square icon button. Geometry only — no font-size and no colour. A caller
 * appending either on top of a baked-in one would stack two utilities for the
 * same CSS property in one class string, and Tailwind resolves that by
 * generated stylesheet order rather than string order (the footgun documented
 * on LBL above). The rail's active home pip must override the colour and set a
 * larger glyph, so both have to come from the call site.
 */
export const BTN =
  "flex h-[27px] w-[27px] cursor-pointer items-center justify-center border transition-colors";

/** the common case: an inactive control that lights up on hover */
export const BTN_IDLE =
  BTN + " border-edge text-ink-dim hover:border-accent hover:text-accent";

/** an unfocused panel drops to 55% so the graph reads through it */
export function panelClass(focused: boolean): string {
  return focused ? GLASS + " shadow-[0_0_44px_rgba(2,6,11,0.92)]" : GLASS_UN;
}

/**
 * Workspace pip. `active` (the workspace you are looking at) outranks status:
 * an idle workspace you are inside must still read as the current one.
 */
export function pipClass(kind: StatusKind, active: boolean): string {
  const live = kind === "waiting" || kind === "running" ? " hud-breathe" : "";
  if (active) return PIP + " border-accent text-accent hud-glow-accent" + live;
  if (kind === "waiting")
    return PIP + " border-warm text-warm hud-glow-warm" + live;
  if (kind === "running")
    return PIP + " border-accent/60 text-accent/80" + live;
  return (
    PIP + " border-edge text-ink-dim hover:border-accent hover:text-accent"
  );
}
