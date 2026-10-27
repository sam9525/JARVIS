import type { ToolEvent } from "../../shared/types";

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
  if (!match || (!vault && !nodeId.endsWith(".md"))) return null;
  return { kind: match[2] === "specs" ? "spec" : "plan", nodeId };
}
