import React from "react";

export type HomeView = "cards" | "fleet";

const OPTIONS: { value: HomeView; label: string }[] = [
  { value: "cards", label: "Cards" },
  { value: "fleet", label: "Fleet" },
];

export default function HomeViewToggle({
  value,
  onChange,
}: {
  value: HomeView;
  onChange: (v: HomeView) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-full border border-edge bg-panel">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          data-testid={`home-view-${o.value}`}
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
