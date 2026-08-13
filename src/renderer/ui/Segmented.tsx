import React from "react";
import { LBL_CY, LBL_DIM } from "./hud";

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
            "cursor-pointer px-2.5 py-1 transition-colors " +
            (o.value === value
              ? LBL_CY + " bg-accent/15"
              : LBL_DIM + " hover:text-ink-muted")
          }
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
