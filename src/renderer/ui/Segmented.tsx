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
    <div className="flex border border-accent/35">
      {options.map((o) => (
        <button
          key={o.value}
          className={
            "cursor-pointer px-2.5 py-1 font-hud text-[9px] uppercase tracking-[0.2em] transition-colors " +
            (o.value === value
              ? "bg-accent/15 text-accent hud-bloom"
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
