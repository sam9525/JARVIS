import type { ToolEvent, VaultGraph, Workspace } from "../../shared/types";
import { isEditOf } from "./preview-opener";

export type PreviewTarget = { workspaceId: string; nodeId: string };

export function previewWorkspace(
  target: PreviewTarget | null,
  workspaces: Workspace[],
): Workspace | null {
  if (!target) return null;
  return workspaces.find((w) => w.id === target.workspaceId) ?? null;
}

// The graph focuses the previewed node only while its workspace is on screen.
export function focusedPreviewNode(
  target: PreviewTarget | null,
  activeId: string | undefined,
  showHome: boolean,
): string | null {
  if (!target || showHome || target.workspaceId !== activeId) return null;
  return target.nodeId;
}

export function isPreviewEdit(
  e: ToolEvent,
  target: PreviewTarget | null,
): boolean {
  return (
    target !== null &&
    e.workspaceId === target.workspaceId &&
    isEditOf(e, target.nodeId)
  );
}

// A non-active workspace resolves links against its cached card graph; with no
// cache, links do not resolve.
export function previewNoteIds(
  target: PreviewTarget,
  activeId: string | undefined,
  activeGraph: VaultGraph,
  cardGraphs: Map<string, VaultGraph>,
): string[] {
  const graph =
    target.workspaceId === activeId
      ? activeGraph
      : cardGraphs.get(target.workspaceId);
  return graph?.nodes.filter((n) => n.type === "note").map((n) => n.id) ?? [];
}
