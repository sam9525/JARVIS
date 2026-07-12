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
    <div className="preview-backdrop" onClick={onClose}>
      <div className="preview-panel" onClick={(e) => e.stopPropagation()}>
        <div className="preview-title">{nodeId}</div>
        <div
          className="preview-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
