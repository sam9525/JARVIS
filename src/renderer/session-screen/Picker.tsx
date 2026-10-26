import React from "react";
import { LBL_DIM } from "../ui/hud";

export type PickerItem = {
  id: string;
  label: React.ReactNode;
  note?: string;
  current?: boolean;
  mono?: boolean;
};

type PickerProps = {
  title: string;
  items: PickerItem[];
  activeIndex: number;
  onChoose: (id: string) => void;
};

export default function Picker({
  title,
  items,
  activeIndex,
  onChoose,
}: PickerProps) {
  return (
    <div className="mb-1.5 border border-accent/35 bg-panel shadow-[0_18px_50px_-20px_rgba(0,0,0,0.8)]">
      <div className={`${LBL_DIM} border-b border-edge px-2.5 py-1`}>
        {title}
      </div>
      {items.length === 0 && (
        <div className="px-2.5 py-1.5 text-xs text-ink-dim">
          Nothing to show
        </div>
      )}
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          // mousedown keeps focus in the textarea
          onMouseDown={(e) => {
            e.preventDefault();
            onChoose(item.id);
          }}
          className={`flex w-full cursor-pointer items-center justify-between gap-2.5 border-0 px-2.5 py-1 text-left text-[12.5px] ${
            i === activeIndex
              ? "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]"
              : "bg-transparent"
          } ${item.current ? "text-accent" : "text-ink"}`}
        >
          <span
            className={`min-w-0 truncate ${item.mono ? "font-mono text-xs" : ""}`}
          >
            {item.label}
            {item.current ? " ✓" : ""}
          </span>
          {item.note && (
            <span className="whitespace-nowrap text-[11.5px] text-ink-dim">
              {item.note}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
