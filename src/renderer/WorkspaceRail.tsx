import React from "react";
import type { Workspace } from "../shared/types";

type WorkspaceRailProps = {
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (ws: Workspace) => void;
};

// Left-edge rail: one button per workspace, vault first. Initials only —
// full name in the tooltip.
export default function WorkspaceRail({
  workspaces,
  activeId,
  onSelect,
}: WorkspaceRailProps) {
  return (
    <div className="flex w-12 flex-none flex-col items-center gap-2 border-r border-edge bg-panel pt-3">
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          title={`${ws.name} (${ws.kind})`}
          onClick={() => onSelect(ws)}
          className={
            "h-9 w-9 cursor-pointer rounded-lg border text-[11px] uppercase transition-colors " +
            (ws.id === activeId
              ? "border-accent text-accent"
              : "border-edge text-ink-dim hover:border-accent hover:text-accent")
          }
        >
          {ws.name.slice(0, 2)}
        </button>
      ))}
    </div>
  );
}
