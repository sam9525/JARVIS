import React from "react";

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
};

// The app's one segmented control. Every pill toggle — section filter, graph
// level, home view — is this component with a different options list.
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
}: Props<T>) {
  return (
    <div className="flex overflow-hidden rounded-full border border-edge bg-panel">
      {options.map((o) => (
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
