import React from "react";
import type { StatusKind, WorkspaceStatus } from "../../shared/types";
import { LBL, LBL_DIM, TOP_ROW } from "../ui/hud";

type HomeHeaderProps = {
  statuses: WorkspaceStatus[];
  children?: React.ReactNode; // the view toggle + the ✋ ↻ ⚙ ▤ cluster
};

// The command center's one header — fleet summary + controls. Cards, Ring and
// Fleet are alternatives to each other, so this sits over all three rather than
// being owned by any one of them. It shares the bezel's top line, hence the
// micro-label type rather than a heading of its own.
export default function HomeHeader({ statuses, children }: HomeHeaderProps) {
  return (
    <div className={TOP_ROW}>
      <span className={LBL + " text-ink"}>All workspaces</span>
      <span data-testid="mc-summary" className={LBL_DIM}>
        {summary(statuses)}
      </span>
      {children}
    </div>
  );
}

function summary(statuses: WorkspaceStatus[]): string {
  const n = (k: StatusKind) => statuses.filter((s) => s.kind === k).length;
  const parts = [
    n("waiting") && `${n("waiting")} waiting`,
    n("running") && `${n("running")} running`,
    n("idle") && `${n("idle")} idle`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "no active sessions";
}
