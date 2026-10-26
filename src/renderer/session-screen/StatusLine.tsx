import React from "react";
import type { StatusLineView } from "../../shared/types";
import { LBL_DIM } from "../ui/hud";
import { meterTone, resetIn } from "./status-format";

const FILL = {
  accent: "bg-accent",
  warm: "bg-warm",
  hot: "bg-warm shadow-[0_0_6px_color-mix(in_srgb,var(--color-warm)_70%,transparent)]",
};

function Meter({ label, pct }: { label: string; pct: number }) {
  return (
    <>
      <span className={LBL_DIM}>{label}</span>
      <span className="h-[3px] w-14 flex-none bg-edge">
        <i
          className={`block h-full ${FILL[meterTone(pct)]}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </span>
      <span className="font-mono text-[11px] tabular-nums text-ink-muted">
        {Math.round(pct)}%
      </span>
    </>
  );
}

function Reset({ at, now }: { at: number | null; now: number }) {
  const text = at === null ? "" : resetIn(at, now);
  return text ? (
    <span className="font-mono text-[10.5px] text-ink-dim">↻{text}</span>
  ) : null;
}

const SEP = <span className="h-2.5 w-px flex-none bg-edge" />;
const ROW = "flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap";

export default function StatusLine({
  view,
  now,
}: {
  view: StatusLineView | null;
  now: number;
}) {
  if (!view) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-edge pt-1.5">
      <div className={ROW}>
        <span className={LBL_DIM}>model</span>
        <span className="text-xs">{view.model}</span>
        {view.effort && (
          <span className="rounded-full border border-warm px-1.5 text-[10.5px] text-warm">
            {view.effort}
          </span>
        )}
        {SEP}
        <span className="text-xs text-ink-muted">{view.folder}</span>
        {view.branch && (
          <span className="text-xs text-accent-soft">{view.branch}</span>
        )}
        {view.contextPct !== null && (
          <>
            {SEP}
            <Meter label="ctx" pct={view.contextPct} />
          </>
        )}
      </div>
      <div className={ROW}>
        {view.fiveHourPct !== null && (
          <>
            <Meter label="5h" pct={view.fiveHourPct} />
            <Reset at={view.fiveHourResetsAt} now={now} />
          </>
        )}
        {view.fiveHourPct !== null && view.sevenDayPct !== null && SEP}
        {view.sevenDayPct !== null && (
          <>
            <Meter label="7d" pct={view.sevenDayPct} />
            <Reset at={view.sevenDayResetsAt} now={now} />
          </>
        )}
      </div>
      {view.commit && (
        <div className={ROW}>
          <span className="min-w-0 truncate text-xs text-ink-muted">
            ⬆ {view.commit}
          </span>
        </div>
      )}
    </div>
  );
}
