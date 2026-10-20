import React, { useEffect, useRef, useState } from "react";
import { renderNote } from "./markdown";
import { highlightCode, previewsAsCode } from "./code-highlight";
import type { Workspace } from "../../shared/types";

type PreviewProps = {
  nodeId: string;
  /** Bumped each time Claude edits this file; a change re-reads it in place. */
  revision: number;
  workspace: Workspace;
  resolveLink: (target: string) => string | null;
  onNavigate: (nodeId: string) => void;
  onClose: () => void;
};

export default function Preview({
  nodeId,
  revision,
  workspace,
  resolveLink,
  onNavigate,
  onClose,
}: PreviewProps) {
  const [html, setHtml] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef<string | null>(null);
  const isCode = previewsAsCode(workspace.kind === "code", nodeId);

  useEffect(() => {
    let stale = false;
    window.jarvis.readNote(workspace.id, nodeId).then(async (md) => {
      // ponytail: no sanitizer — it's the user's own vault/repo in a sandboxed
      // renderer; add DOMPurify if untrusted sources ever become a thing
      let rendered: string;
      if (md === null) {
        rendered = "<em>file not found</em>";
      } else if (previewsAsCode(workspace.kind === "code", nodeId)) {
        const changes = await window.jarvis.lineChanges(workspace.id, nodeId);
        rendered = await highlightCode(md, nodeId, changes);
      } else {
        rendered = await renderNote(md, {
          resolveLink,
          loadNote: (id: string) => window.jarvis.readNote(workspace.id, id),
        });
      }
      if (stale) return;
      setHtml(rendered);
      // a new file (wikilink nav) starts at the top; a re-read after an edit
      // keeps your place in the same file
      if (shownRef.current !== nodeId) panelRef.current?.scrollTo(0, 0);
      shownRef.current = nodeId;
    });
    return () => {
      stale = true;
    };
  }, [nodeId, revision, workspace, resolveLink]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onBodyClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault(); // never navigate the Electron window itself
    if (a.dataset.node) onNavigate(a.dataset.node);
    else if (/^https?:/i.test(a.href)) window.open(a.href); // → system browser
  };

  return (
    <div
      ref={panelRef}
      className="h-full overflow-x-hidden overflow-y-auto px-4 py-3 font-sans text-sm leading-relaxed text-ink"
    >
      {isCode ? (
        <div
          className="code-preview"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div
          className="preview-body"
          onClick={onBodyClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
