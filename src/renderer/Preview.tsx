import React, { useEffect, useRef, useState } from "react";
import { renderNote } from "./markdown";

type PreviewProps = {
  nodeId: string;
  resolveLink: (target: string) => string | null;
  onNavigate: (nodeId: string) => void;
  onClose: () => void;
};

export default function Preview({
  nodeId,
  resolveLink,
  onNavigate,
  onClose,
}: PreviewProps) {
  const [html, setHtml] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stale = false;
    window.jarvis.readNote(nodeId).then(async (md) => {
      // ponytail: no sanitizer — it's the user's own vault in a sandboxed
      // renderer; add DOMPurify if untrusted vaults ever become a thing
      const rendered =
        md === null
          ? "<em>file not found</em>"
          : await renderNote(md, {
              resolveLink,
              loadNote: window.jarvis.readNote,
            });
      if (stale) return;
      setHtml(rendered);
      panelRef.current?.scrollTo(0, 0); // wikilink nav starts at the top
    });
    return () => {
      stale = true;
    };
  }, [nodeId, resolveLink]);

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
      <div
        className="preview-body"
        onClick={onBodyClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
