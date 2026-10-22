import React from "react";
import type {
  GraphGroup,
  StatusKind,
  VaultGraph,
  ViewSettings,
  Workspace,
  WorkspaceStatus,
} from "../../shared/types";
import type { HighlightState } from "../session/highlight-store";
import type { GraphFilters } from "../graph/graph-filter";
import MiniGraph from "../graph/MiniGraph";
import { hueOfWorkspace } from "../graph/workspace-color";
import EmptyGraph, { canIndex, type IndexState } from "../graph/EmptyGraph";
import { LIST_STEP_MS } from "../ui/boot-stage";
import { relativeTime } from "./relative-time";

const CARD_W = 220;
const CARD_H = 150;

const LABEL: Record<StatusKind, string> = {
  working: "working",
  asking: "asking you",
  blocked: "needs approval",
  idle: "idle",
  crashed: "crashed",
  none: "no session",
};

export const DOT: Record<StatusKind, string> = {
  working: "bg-accent",
  asking: "bg-warm hud-glow-warm",
  blocked: "bg-warm",
  idle: "bg-ink-dim",
  crashed: "bg-alarm",
  none: "border border-ink-dim",
};

const TEXT: Record<StatusKind, string> = {
  working: "text-accent",
  asking: "text-warm",
  blocked: "text-warm",
  idle: "text-ink-dim",
  crashed: "text-alarm",
  none: "text-ink-dim",
};

const BORDER: Record<StatusKind, string> = {
  working: "border-accent",
  asking: "border-warm",
  blocked: "border-warm",
  idle: "border-edge",
  crashed: "border-alarm",
  none: "border-edge",
};

type MissionControlProps = {
  workspaces: Workspace[];
  mainColors?: Record<string, string>; // workspace id → its main colour
  statuses: WorkspaceStatus[];
  graphs: Map<string, VaultGraph>; // only the workspaces loaded so far
  getStore: (workspaceId: string) => HighlightState;
  groups: Record<string, GraphGroup[]>; // per workspace id, like the 2D view
  view: ViewSettings; // the 2D view's settings — thumbnails render with them
  filters: Omit<GraphFilters, "search">; // cards hide what the view hides
  now: number; // passed in, not read — keeps this component hook-free
  onSelect: (ws: Workspace) => void;
  // keyed by workspace id; absent means idle
  indexing: Record<string, { state: IndexState; error?: string }>;
  onIndex: (workspaceId: string) => void;
  /** Play the entrance run across the cards. App passes `stage >= 2`. */
  stagger?: boolean;
};

// Every workspace at a glance. Presentation only — the status array arrives
// ready-made from main, and no card computes state of its own.
export default function MissionControl({
  workspaces,
  mainColors,
  statuses,
  graphs,
  getStore,
  groups,
  view,
  filters,
  now,
  onSelect,
  indexing,
  onIndex,
  stagger,
}: MissionControlProps) {
  const byId = new Map(statuses.map((s) => [s.workspaceId, s]));
  // same shape as the rail's run: held closed until the stage opens, then one
  // card every LIST_STEP_MS. The delay counts across the whole wrapped grid,
  // so the run reads left-to-right down the rows rather than per row.
  const enter = (index: number) =>
    stagger
      ? {
          className: " boot-in",
          style: { animationDelay: `${index * LIST_STEP_MS}ms` },
        }
      : { className: " boot-hold", style: undefined };

  return (
    // pt clears the App-level HomeHeader and pl the WorkspaceRail — both float
    // over all three home views, but only cards are a laid-out surface that
    // would otherwise sit underneath them.
    <div className="h-full overflow-y-auto pl-[72px] pr-5 pt-12 pb-5">
      <div className="flex flex-wrap gap-3.5">
        {workspaces.map((ws, i) => {
          const e = enter(i);
          const st = byId.get(ws.id);
          const kind: StatusKind = st?.kind ?? "none";
          const g = graphs.get(ws.id);
          // absent from the map = still loading; empty = analyzed to nothing,
          // or never analyzed at all. Only the second earns the button.
          const needsIndex = canIndex(ws) && !!g && g.nodes.length === 0;
          const idx = indexing[ws.id];

          return (
            <div
              key={ws.id}
              data-testid={`card-${ws.id}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(ws)}
              // a div is not a button, so Enter/Space have to be wired by hand.
              // It has to be a div: a <button> cannot legally contain the index
              // button inside the thumbnail below.
              onKeyDown={(e) => {
                // the index button inside sits in this bubble path: its own
                // Enter fires keydown here before its click, so without this
                // guard keying it would navigate instead of indexing
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(ws);
                }
              }}
              style={{ width: CARD_W + 26, ...e.style }}
              className={
                "flex cursor-pointer flex-col gap-2.5 rounded-lg border bg-panel p-3 text-left transition-colors hover:ring-1 hover:ring-ink-muted " +
                BORDER[kind] +
                e.className
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  data-testid={`name-${ws.id}`}
                  className="text-[13px] font-semibold text-ink"
                >
                  {ws.name}
                </span>
                <span className="rounded border border-edge px-1.5 font-mono text-[9px] uppercase tracking-widest text-ink-dim">
                  {ws.kind}
                </span>
              </div>

              <div
                data-testid={`status-${ws.id}`}
                className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide ${TEXT[kind]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${DOT[kind]}`} />
                {LABEL[kind]}
                {st?.delegatedBy && (
                  <span className="truncate normal-case text-ink-dim">
                    ↳ delegated by {st.delegatedBy}
                  </span>
                )}
              </div>

              {/* one line, ellipsized — a card's height never depends on what
                  Claude happens to be doing */}
              <div
                data-testid={`call-${ws.id}`}
                title={st?.call || undefined}
                className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] text-accent-soft"
              >
                {st?.call || " "}
              </div>

              {needsIndex ? (
                <div
                  style={{ width: CARD_W, height: CARD_H }}
                  className="overflow-hidden rounded border border-dashed border-edge"
                >
                  <EmptyGraph
                    state={idx?.state ?? "idle"}
                    error={idx?.error}
                    failed={g?.failed}
                    onIndex={() => onIndex(ws.id)}
                    compact
                  />
                </div>
              ) : (
                <MiniGraph
                  graph={g ?? null}
                  kind={ws.kind}
                  baseHue={hueOfWorkspace(ws, workspaces, mainColors)}
                  state={getStore(ws.id)}
                  groups={groups[ws.id] ?? []}
                  view={view}
                  filters={filters}
                  width={CARD_W}
                  height={CARD_H}
                />
              )}

              <div
                data-testid={`counts-${ws.id}`}
                className="flex gap-3 border-t border-edge pt-2 font-mono text-[11px] tabular-nums text-ink-dim"
              >
                <span>
                  <b className="font-semibold text-ink-muted">
                    {st?.reads ?? 0}
                  </b>{" "}
                  read
                </span>
                <span>
                  <b className="font-semibold text-ink-muted">
                    {st?.edits ?? 0}
                  </b>{" "}
                  edited
                </span>
                <span className="ml-auto">
                  {relativeTime(st?.since ?? 0, now)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
