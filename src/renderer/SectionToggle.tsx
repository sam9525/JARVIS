import React from "react";
import type { SectionFilter } from "../shared/types";

const OPTIONS: { value: SectionFilter; label: string }[] = [
  { value: "raw", label: "Raw" },
  { value: "wiki", label: "Wiki" },
  { value: "both", label: "Both" },
];

type Props = {
  value: SectionFilter;
  onChange: (f: SectionFilter) => void;
};

export default function SectionToggle({ value, onChange }: Props) {
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
