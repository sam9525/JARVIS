import React from "react";
import type { Workspace, WorkspaceStatus } from "../shared/types";

export default function MessageDetail({
  workspace,
  status,
  onClose,
}: {
  workspace: Workspace | null;
  status: WorkspaceStatus | null;
  onClose: () => void;
}) {
  if (!workspace) return null;
  const body = status?.message || status?.call || "";
  return (
    <div
      className="absolute top-3 right-3 bottom-3 z-20 flex w-[340px] flex-col rounded-lg border border-edge bg-panel/95 shadow-lg"
      data-testid="message-detail"
    >
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <span className="flex-1 truncate text-[13px] font-semibold text-ink">
          {workspace.name}
        </span>
        <button
          data-testid="message-detail-close"
          className="cursor-pointer text-ink-dim hover:text-accent"
          title="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div
        className="overflow-y-auto whitespace-pre-wrap px-3 py-3 text-[13px] leading-relaxed text-ink"
        data-testid="message-detail-body"
      >
        {body || "No message yet."}
      </div>
    </div>
  );
}
