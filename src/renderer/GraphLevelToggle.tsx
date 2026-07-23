import React from "react";
import type { CodeGraphLevel, WorkspaceKind } from "../shared/types";

const OPTIONS: { value: CodeGraphLevel; label: string }[] = [
  { value: "file", label: "Files" },
  { value: "symbol", label: "Symbols" },
];

type Props = {
  kind: WorkspaceKind;
  value: CodeGraphLevel;
  onChange: (l: CodeGraphLevel) => void;
};

export default function GraphLevelToggle({ kind, value, onChange }: Props) {
  if (kind !== "code") return null; // vault workspaces have no symbols
  return (
    <div className="flex overflow-hidden rounded-full border border-edge bg-panel">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          className={
            "cursor-pointer px-2.5 py-1 text-[13px] transition-colors " +
            (o.value === value
              ? "bg-edge text-ink"
              : "text-ink-dim hover:text-ink-muted")
          }
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
