import type { AskAnswer } from "../../main/ask-mapper";
import type { ToolEvent } from "../../shared/types";
import type { PreviewTarget } from "../preview/preview-target";

export type DocKind = "spec" | "plan";

/** Document kind → the node id of the file Claude last wrote for it. */
export type AskDocs = Partial<Record<DocKind, string>>;

const DOC_PATH = /(^|\/)docs\/superpowers\/(specs|plans)\/[^/]+$/;

export function docKindOf(header: string): DocKind | null {
  const name = header.trim().toLowerCase();
  return name === "spec" || name === "plan" ? name : null;
}

/**
 * A finished Edit or Write of a spec or plan file. Code ids keep the
 * extension, so they must end in `.md`; vault ids are `.md`-only with the
 * extension stripped, and file names such as `v0.4.4-boot` hold dots, so
 * they get no extension test.
 */
export function docWriteOf(
  e: ToolEvent,
  vault: boolean,
): { kind: DocKind; nodeId: string } | null {
  if (e.phase !== "post" || (e.tool !== "Edit" && e.tool !== "Write")) {
    return null;
  }
  const nodeId = e.nodeIds[0];
  if (!nodeId) return null;
  const match = DOC_PATH.exec(nodeId);
  if (!match || (!vault && !/\.md$/i.test(nodeId))) return null;
  return { kind: match[2] === "specs" ? "spec" : "plan", nodeId };
}

/**
 * Event node ids drop the `.worktrees/<label>/` prefix, but a worktree
 * session's gitignored docs exist only under it, so the preview needs it back.
 */
export function docPreviewId(
  nodeId: string,
  worktreeLabel: string | null,
): string {
  return worktreeLabel ? `.worktrees/${worktreeLabel}/${nodeId}` : nodeId;
}

/**
 * True when an answer approves a spec or plan and the open preview is exactly
 * that session's document of the kind: approving it ends the review, but any
 * other open file is none of the answer's business.
 */
export function approvedDocClose(
  answers: AskAnswer[],
  docs: AskDocs | undefined,
  askWorkspaceId: string,
  preview: PreviewTarget | null,
): boolean {
  if (!preview || preview.workspaceId !== askWorkspaceId) return false;
  return answers.some((a) => {
    const kind = docKindOf(a.header);
    if (!kind || !a.label.trim().toLowerCase().startsWith("approve"))
      return false;
    const nodeId = docs?.[kind];
    return nodeId !== undefined && preview.nodeId === nodeId;
  });
}
