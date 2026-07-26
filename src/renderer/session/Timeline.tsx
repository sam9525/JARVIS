import React from "react";
import type { ToolEvent } from "../../shared/types";
import { chaptersOf, labelOf } from "./replay";

type TimelineProps = {
  log: ToolEvent[];
  index: number | null; // null = live, i.e. parked at the last event
  onScrub: (index: number | null) => void;
};

// Overlay at the foot of the graph slot. Hook-free on purpose: the repo's test
// shim calls this function directly. The control is a native range input, which
// brings drag, click-to-position, arrow keys, Home/End and focus for free — and
// only takes keys while focused, so it cannot fight the terminal.
export default function Timeline({ log, index, onScrub }: TimelineProps) {
  if (!log.length) return null;
  const last = log.length - 1;
  const at = Math.min(index ?? last, last);
  const live = index === null;
  const pct = (i: number) => `${last === 0 ? 0 : (i / last) * 100}%`;

  return (
    <div className="absolute right-3 bottom-3 left-3 z-10 flex items-center gap-3 rounded-lg border border-edge bg-panel/90 px-3 py-2 backdrop-blur">
      <button
        data-testid="replay-live"
        className="cursor-pointer rounded border border-edge px-2 py-0.5 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-edge disabled:hover:text-ink-dim"
        disabled={live}
        onClick={() => onScrub(null)}
        title="Return to live"
      >
        Live
      </button>
      <div className="relative min-w-0 flex-1">
        <div
          data-testid="replay-chapters"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2"
        >
          {chaptersOf(log).map((c) => (
            <div
              key={c}
              className="absolute top-0 h-full w-px bg-accent/50"
              style={{ left: pct(c) }}
            />
          ))}
        </div>
        <input
          data-testid="replay-range"
          type="range"
          className="relative w-full accent-accent"
          min={0}
          max={last}
          value={at}
          onChange={(e) => {
            const v = Number(e.target.value);
            onScrub(v >= last ? null : v);
          }}
        />
      </div>
      <span
        data-testid="replay-label"
        className={`max-w-[40%] truncate text-[11px] ${live ? "text-ink-dim" : "text-accent"}`}
      >
        {live ? "" : "⏮ "}
        {labelOf(log[at])}
      </span>
      <span
        data-testid="replay-position"
        className="shrink-0 text-[11px] text-ink-dim tabular-nums"
      >
        {at + 1} / {log.length}
      </span>
    </div>
  );
}
