import React, { useLayoutEffect, useRef, useState } from "react";
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
  // The fill travels between options instead of jumping, so the control reads
  // as one moving part. It has to be measured: the labels are different widths,
  // and CSS has no way to ask where a sibling starts.
  const wrap = useRef<HTMLDivElement>(null);
  const [fill, setFill] = useState<{ left: number; width: number } | null>(
    null,
  );
  // Deps, not every render: reading offsetLeft forces synchronous layout, and
  // the owner re-renders on every hook event with two of these on screen. The
  // labels are static, so only a new selection or a new option list moves the
  // fill. The equality bail-out still guards the loop this sets state inside.
  useLayoutEffect(() => {
    const on = wrap.current?.querySelector<HTMLElement>('[data-on="1"]');
    // a value matching no option hides the fill rather than stranding it under
    // whichever option happened to be selected last
    if (!on) return setFill(null);
    setFill((f) =>
      f && f.left === on.offsetLeft && f.width === on.offsetWidth
        ? f
        : { left: on.offsetLeft, width: on.offsetWidth },
    );
  }, [value, options]);

  return (
    <div ref={wrap} className="relative flex border border-accent/35">
      {/* Before paint, so the first fill lands with its geometry already set
          and the control does not slide in from the left edge on mount. */}
      {fill && (
        <span
          aria-hidden
          data-testid="segmented-fill"
          // segmented-fill, not a transition utility: the reduced-motion block
          // in index.css can only name classes it owns
          className="segmented-fill pointer-events-none absolute inset-y-0 bg-accent/15"
          style={fill}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          data-on={o.value === value ? "1" : undefined}
          // relative, so the label sits over the fill rather than under it
          className={
            "relative cursor-pointer px-2.5 py-1 transition-colors " +
            (o.value === value ? LBL_CY : LBL_DIM + " hover:text-ink-muted")
          }
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
