import React from "react";
import type {
  StatusKind,
  Workspace,
  WorkspaceStatus,
} from "../../shared/types";

const DOT: Record<StatusKind, string> = {
  working: "bg-accent",
  asking: "bg-warm hud-glow-warm",
  blocked: "bg-warm",
  idle: "bg-ink-dim",
  crashed: "bg-alarm",
  none: "bg-ink-dim",
};

// idle shows the last message; waiting/running show the call line
function preview(s: WorkspaceStatus): string {
  return s.kind === "idle" ? (s.message ?? "") : s.call;
}

// The main agent's whole job is to write you a sentence about the fleet, so its
// idle summary wraps to as many lines as it takes. A running call line stays on
// one line even there — a wrapped Bash command pushes the fleet off screen to
// say nothing.
function wraps(w: Workspace, s: WorkspaceStatus): boolean {
  return Boolean(w.isSelf) && s.kind === "idle";
}

export default function Inbox({
  workspaces,
  statuses,
  activeId,
  onSelect,
}: {
  workspaces: Workspace[];
  statuses: WorkspaceStatus[];
  activeId: string | null;
  onSelect: (ws: Workspace) => void;
}) {
  const byId = new Map(statuses.map((s) => [s.workspaceId, s]));
  const live = workspaces.filter((w) => {
    const s = byId.get(w.id);
    return s && s.kind !== "none";
  });
  return (
    <div className="flex min-h-0 flex-col overflow-y-auto" data-testid="inbox">
      {live.map((w) => {
        const s = byId.get(w.id)!;
        return (
          <button
            key={w.id}
            data-testid={`inbox-row-${w.id}`}
            onClick={() => onSelect(w)}
            className={`flex items-start gap-2 border-b border-edge px-3 py-2 text-left ${
              w.id === activeId ? "bg-warm/10" : "hover:bg-accent/5"
            }`}
          >
            <span
              className={`mt-1.5 h-2 w-2 flex-none rounded-full ${DOT[s.kind]}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold text-ink">
                  {w.name}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-ink-dim">
                  {s.kind}
                </span>
                {s.delegatedBy && (
                  <span
                    data-testid={`inbox-delegated-${w.id}`}
                    className="truncate text-[11px] text-warm"
                  >
                    ↳ delegated by {s.delegatedBy}
                  </span>
                )}
              </span>
              <span
                className={`block text-[12px] text-ink-dim ${
                  wraps(w, s) ? "" : "truncate"
                }`}
                data-testid={`inbox-preview-${w.id}`}
              >
                {preview(s)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
