import React from "react";

export type IndexState = "idle" | "running" | "error";

type EmptyGraphProps = {
  state: IndexState;
  error?: string;
  onIndex: () => void;
  compact?: boolean; // sized for a 220×150 mission-control card
};

const BUTTON_TEXT: Record<IndexState, string> = {
  idle: "Index with GitNexus",
  running: "indexing…",
  error: "index failed — retry",
};

// Shown wherever a code workspace's graph came back empty — a project added
// before it was ever analyzed, or a registry entry whose index is unreadable.
// Both cases are fixed by the same command, so both get the same button.
export default function EmptyGraph({
  state,
  error,
  onIndex,
  compact = false,
}: EmptyGraphProps) {
  return (
    <div
      data-testid="empty-graph"
      className={
        "flex h-full w-full flex-col items-center justify-center gap-2 text-center " +
        (compact ? "px-2" : "px-4")
      }
    >
      <span
        className={
          "text-ink-dim " + (compact ? "text-[10px]" : "text-[12.5px]")
        }
      >
        No GitNexus index
      </span>
      <button
        data-testid="index-button"
        disabled={state === "running"}
        title={state === "error" && error ? error : "Run gitnexus analyze here"}
        // the card behind this is itself a click target; indexing must not
        // also navigate into the workspace
        onClick={(e) => {
          e.stopPropagation();
          onIndex();
        }}
        className={
          "cursor-pointer rounded border border-edge text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-60 disabled:hover:border-edge disabled:hover:text-ink-dim " +
          (compact ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-[12px]") +
          (state === "error" ? " border-warm text-warm" : "")
        }
      >
        {BUTTON_TEXT[state]}
      </button>
    </div>
  );
}
