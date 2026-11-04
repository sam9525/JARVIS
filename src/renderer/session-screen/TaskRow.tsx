import React, { useState } from "react";
import type { ScreenItem } from "./screen-state";

type TaskItem = Extract<ScreenItem, { kind: "task" }>;

export default function TaskRow({ item }: { item: TaskItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 border-l-2 border-edge bg-transparent px-2 py-0.5 text-left font-mono text-xs text-ink-muted"
      >
        <span className={item.failed ? "text-warm" : "text-accent"}>●</span>
        <span className="min-w-0 truncate">{item.summary}</span>
        <span className="ml-auto whitespace-nowrap text-ink-dim">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <pre className="ml-2.5 mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-edge bg-abyss px-2 py-1.5 font-mono text-[11.5px] leading-normal text-ink-muted">
          {item.full}
        </pre>
      )}
    </div>
  );
}
