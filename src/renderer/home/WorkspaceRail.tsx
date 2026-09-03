import React from "react";
import { SOURCE_LABELS } from "../../shared/types";
import type {
  Workspace,
  WorkspaceStatus,
  StatusKind,
} from "../../shared/types";
import { BTN, BTN_IDLE, LBL_DIM, pipClass } from "../ui/hud";

type WorkspaceRailProps = {
  workspaces: Workspace[];
  activeId: string | null;
  statuses: WorkspaceStatus[];
  homeActive: boolean;
  onHome: () => void;
  onSelect: (ws: Workspace) => void;
  onAddProject: () => void;
  /** Play the entrance run down the column. App passes `stage >= 1`. */
  stagger?: boolean;
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

// gap between two rail buttons entering; the whole column, not per group
const RAIL_STEP_MS = 60;

function groupBySource(workspaces: Workspace[]): Array<[string, Workspace[]]> {
  const groups = new Map<string, Workspace[]>();
  for (const ws of workspaces) {
    const list = groups.get(ws.sourceId) ?? [];
    list.push(ws);
    groups.set(ws.sourceId, list);
  }
  return [...groups.entries()];
}

// Left-edge rail: one button per workspace, vault first. Initials only —
// full name and live status in the tooltip.
export default function WorkspaceRail({
  workspaces,
  activeId,
  statuses,
  homeActive,
  onHome,
  onSelect,
  onAddProject,
  stagger,
}: WorkspaceRailProps) {
  const byId = new Map(statuses.map((s) => [s.workspaceId, s]));
  // a running counter over the flattened column — the index within a source
  // group would restart the run at every caption
  let seat = 0;
  const enter = (index: number) =>
    stagger
      ? {
          className: " boot-in",
          style: { animationDelay: `${index * RAIL_STEP_MS}ms` },
        }
      : { className: "", style: undefined };

  return (
    <div className="flex w-14 flex-none flex-col items-center gap-3 pt-[88px]">
      {(() => {
        const e = enter(seat++);
        return (
          <button
            data-testid="rail-home"
            title="Mission control — all workspaces"
            onClick={onHome}
            style={e.style}
            className={
              (homeActive
                ? BTN +
                  " mb-1 rounded-full text-[13px] border-accent text-accent hud-glow-accent"
                : BTN_IDLE + " mb-1 rounded-full text-[13px]") + e.className
            }
          >
            ⌂
          </button>
        );
      })()}
      {groupBySource(workspaces).map(([sourceId, group]) => {
        const ce = enter(++seat);
        return (
          <React.Fragment key={sourceId}>
            <div
              data-testid={`rail-group-${sourceId}`}
              style={ce.style}
              className={LBL_DIM + " w-12 pt-1 text-center" + ce.className}
            >
              {SOURCE_LABELS[sourceId] ?? sourceId}
            </div>
            {group.map((ws) => {
              const st = byId.get(ws.id);
              const badge = st ? BADGE[st.kind] : null;
              const state = st ? LABEL[st.kind] : "no session";
              const label = SOURCE_LABELS[ws.sourceId] ?? ws.sourceId;
              const title =
                `${ws.name} (${ws.kind} · ${label}) — ${state}` +
                (st?.call ? ` — ${st.call}` : "");
              const e = enter(seat++);
              return (
                <button
                  key={ws.id}
                  title={title}
                  onClick={() => onSelect(ws)}
                  style={e.style}
                  className={
                    "relative cursor-pointer uppercase " +
                    pipClass(
                      st?.kind ?? "none",
                      !homeActive && ws.id === activeId,
                    ) +
                    e.className
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
          </React.Fragment>
        );
      })}
      {(() => {
        const e = enter(seat++);
        return (
          <button
            data-testid="rail-add"
            title="Add a project folder"
            onClick={onAddProject}
            style={e.style}
            className={
              BTN_IDLE + " rounded-full border-dashed text-[13px]" + e.className
            }
          >
            +
          </button>
        );
      })()}
    </div>
  );
}
