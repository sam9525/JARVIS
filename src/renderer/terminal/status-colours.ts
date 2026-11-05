import type { StatusKind } from "../../shared/types";

// same state colors the rail badges and inbox dots use — amber is waiting on
// you (asking or blocked), red is a session that died
export const PILL: Record<StatusKind, string> = {
  working: "border-accent/30 bg-accent/10 text-accent",
  asking: "border-warm/30 bg-warm/10 text-warm",
  blocked: "border-warm/30 bg-warm/10 text-warm",
  idle: "border-ink-dim/30 bg-ink-dim/10 text-ink-dim",
  crashed: "border-alarm/30 bg-alarm/10 text-alarm",
  none: "border-ink-dim/30 bg-ink-dim/10 text-ink-dim",
};
