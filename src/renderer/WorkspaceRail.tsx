import React from "react";
import type { Workspace, WorkspaceStatus, StatusKind } from "../shared/types";

type WorkspaceRailProps = {
  workspaces: Workspace[];
  activeId: string | null;
  statuses: WorkspaceStatus[];
  homeActive: boolean;
  onHome: () => void;
  onSelect: (ws: Workspace) => void;
};

// "waiting" is the only state that earns attention — it pulses and takes the
// one warm color on screen. Everything else is ambient.
const BADGE: Record<StatusKind, string | null> = {
  waiting: "bg-warm animate-pulse",
  running: "bg-accent",
  idle: "bg-ink-dim",
  none: null, // no session — nothing to say
};

const LABEL: Record<StatusKind, string> = {
  waiting: "waiting on you",
  running: "running",
  idle: "idle",
  none: "no session",
};

// Left-edge rail: one button per workspace, vault first. Initials only —
// full name and live status in the tooltip.
export default function WorkspaceRail({
  workspaces,
  activeId,
  statuses,
  homeActive,
  onHome,
  onSelect,
}: WorkspaceRailProps) {
  const byId = new Map(statuses.map((s) => [s.workspaceId, s]));
  return (
    <div className="flex w-12 flex-none flex-col items-center gap-2 border-r border-edge bg-panel pt-3">
      <button
        data-testid="rail-home"
        title="Mission control — all workspaces"
        onClick={onHome}
        className={
          "mb-1 h-9 w-9 cursor-pointer rounded-lg border text-[13px] transition-colors " +
          (homeActive
            ? "border-accent text-accent"
            : "border-edge text-ink-dim hover:border-accent hover:text-accent")
        }
      >
        ⌂
      </button>
      {workspaces.map((ws) => {
        const st = byId.get(ws.id);
        const badge = st ? BADGE[st.kind] : null;
        const state = st ? LABEL[st.kind] : "no session";
        const title =
          `${ws.name} (${ws.kind}) — ${state}` +
          (st?.call ? ` — ${st.call}` : "");
        return (
          <button
            key={ws.id}
            title={title}
            onClick={() => onSelect(ws)}
            className={
              "relative h-9 w-9 cursor-pointer rounded-lg border text-[11px] uppercase transition-colors " +
              (!homeActive && ws.id === activeId
                ? "border-accent text-accent"
                : "border-edge text-ink-dim hover:border-accent hover:text-accent")
            }
          >
            {ws.name.slice(0, 2)}
            {badge && (
              <span
                data-testid={`badge-${ws.id}`}
                className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-panel ${badge}`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
