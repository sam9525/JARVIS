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
    <div className="section-toggle">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}