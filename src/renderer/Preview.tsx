import React, { useEffect, useState } from "react";
import { marked } from "marked";

type PreviewProps = { nodeId: string; onClose: () => void };

export default function Preview({ nodeId, onClose }: PreviewProps) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let stale = false;
    window.jarvis.readNote(nodeId).then((md) => {
      if (stale) return;
      // ponytail: no sanitizer — it's the user's own vault in a sandboxed
      // renderer; add DOMPurify if untrusted vaults ever become a thing
      setHtml(
        md === null ? "<em>file not found</em>" : (marked.parse(md) as string),
      );
    });
    return () => {
      stale = true;
    };
  }, [nodeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed top-2.5 bottom-2.5 left-2.5 w-[min(560px,40vw)] overflow-auto rounded-[10px] border border-edge bg-panel px-7 py-6 font-sans text-sm leading-relaxed text-ink">
      <div className="mb-3 flex items-baseline justify-between">
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
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
