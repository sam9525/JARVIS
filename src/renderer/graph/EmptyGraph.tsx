import React from "react";
import type { Workspace } from "../../shared/types";

export type IndexState = "idle" | "running" | "error";

// gitnexus is the one source the app can index, so it is the one source this
// panel can offer anything to; a bare folder counts because indexing is how it
// becomes one. A graphify workspace with an empty graph has a broken
// graph.json, not a missing index — offering the button there would quietly
// convert it to a different source on the next boot.
export const canIndex = (ws: Workspace): boolean =>
  ws.kind === "code" &&
  (ws.sourceId === "gitnexus" || ws.sourceId === "unknown");

type EmptyGraphProps = {
  state: IndexState;
  error?: string;
  onIndex: () => void;
  compact?: boolean; // sized for a 220×150 mission-control card
  // the graph's `failed` reason: the index exists but could not be read, so
  // indexing again is the wrong advice and the button is not offered
  failed?: string;
};

const BUTTON_TEXT: Record<IndexState, string> = {
  idle: "Index with GitNexus",
  running: "indexing…",
  error: "index failed — retry",
};

// Shown wherever a code workspace's graph came back empty. A project that was
// never analyzed gets the index button; a read that failed gets its reason.
export default function EmptyGraph({
  state,
  error,
  onIndex,
  compact = false,
  failed,
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
        {failed ?? "No GitNexus index"}
      </span>
      {!failed && (
        <button
          data-testid="index-button"
          disabled={state === "running"}
          title={
            state === "error" && error ? error : "Run gitnexus analyze here"
          }
          // the card behind this is itself a click target; indexing must not
          // also navigate into the workspace
          onClick={(e) => {
            e.stopPropagation();
            onIndex();
          }}
          className={
            "cursor-pointer rounded border border-edge text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-60 disabled:hover:border-edge disabled:hover:text-ink-dim " +
            (compact
              ? "px-1.5 py-0.5 text-[10px]"
              : "px-2.5 py-1 text-[12px]") +
            (state === "error" ? " border-warm text-warm" : "")
          }
        >
          {BUTTON_TEXT[state]}
        </button>
      )}
    </div>
  );
}
