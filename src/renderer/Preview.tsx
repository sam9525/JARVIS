import React, { useEffect, useRef, useState } from "react";
import { renderNote } from "./markdown";
import type { Workspace } from "../shared/types";

type PreviewProps = {
  nodeId: string;
  workspace: Workspace;
  resolveLink: (target: string) => string | null;
  onNavigate: (nodeId: string) => void;
  onClose: () => void;
};

export default function Preview({
  nodeId,
  workspace,
  resolveLink,
  onNavigate,
  onClose,
}: PreviewProps) {
  const [html, setHtml] = useState("");
  const [text, setText] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stale = false;
    window.jarvis.readNote(workspace.id, nodeId).then(async (md) => {
      // ponytail: no sanitizer — it's the user's own vault in a sandboxed
      // renderer; add DOMPurify if untrusted vaults ever become a thing
      const rendered =
        md === null
          ? "<em>file not found</em>"
          : workspace.kind === "code"
            ? null // code mode renders plain text below, not markdown
            : await renderNote(md, {
                resolveLink,
                loadNote: (id: string) =>
                  window.jarvis.readNote(workspace.id, id),
              });
      if (stale) return;
      setText(workspace.kind === "code" ? md : null);
      setHtml(rendered ?? "");
      panelRef.current?.scrollTo(0, 0); // wikilink nav starts at the top
    });
    return () => {
      stale = true;
    };
  }, [nodeId, workspace, resolveLink]);

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
      className="fixed top-2.5 bottom-2.5 left-2.5 w-[min(560px,40vw)] overflow-y-auto overflow-x-hidden rounded-[10px] border border-edge bg-panel px-4 py-3 font-sans text-sm leading-relaxed text-ink"
    >
      <div className="sticky -top-3 -mx-4 mb-3 flex items-baseline justify-between bg-panel px-4 py-2">
        <div className="text-xs text-ink-dim">{nodeId}</div>
        <button
          className="cursor-pointer text-sm text-ink-dim hover:text-accent"
          title="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {text !== null ? (
        <pre className="overflow-x-auto whitespace-pre p-4 text-[12px] leading-relaxed">
          {text}
        </pre>
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
