import React from "react";
import { SOURCE_LABELS } from "../../shared/types";
import type {
  Workspace,
  WorkspaceStatus,
  StatusKind,
} from "../../shared/types";
import { BTN, BTN_IDLE, LBL_DIM, pipClass } from "../ui/hud";
import { LIST_STEP_MS } from "../ui/boot-stage";

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

// The two stopped states earn attention and take the one warm colour on
// screen; crashed takes the only red. Everything else is ambient.
const BADGE: Record<StatusKind, string | null> = {
  working: "bg-accent",
  asking: "bg-warm animate-pulse",
  blocked: "bg-warm animate-pulse",
  idle: "bg-ink-dim",
  crashed: "bg-alarm",
  none: null, // no session — nothing to say
};

const LABEL: Record<StatusKind, string> = {
  working: "working",
  asking: "asking you",
  blocked: "needs approval",
  idle: "idle",
  crashed: "crashed",
  none: "no session",
};

/**
 * How many entrance slots the column has, so the boot sequence can hold the
 * next stage until this run finishes. The ⌂ and ＋ buttons bracket the list,
 * and each source caption takes a slot of its own — it shares the delay of the
 * button below it, but the run still steps past it. Slot 1 is skipped: the
 * first group's `++seat` steps over it, which leaves one 60ms hole between the
 * ⌂ and the first caption and is why this counts slots rather than elements.
 */
export function railSeats(workspaces: Workspace[]): number {
  const sources = new Set(workspaces.map((ws) => ws.sourceId));
  return 2 + sources.size + workspaces.length;
}

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
          style: { animationDelay: `${index * LIST_STEP_MS}ms` },
        }
      : // held closed, not just unanimated: the ⌂ button paints from the first
        // frame, so leaving it visible means it blinks out when `boot-in` lands
        { className: " boot-hold", style: undefined };

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
