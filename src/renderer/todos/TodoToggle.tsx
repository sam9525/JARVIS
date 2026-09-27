import React from "react";

// The ☑ button, sized and styled to sit in the ✋/🎤/↻/⚙ row.
export default function TodoToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle(): void;
}) {
  return (
    <button
      data-testid="todo-toggle"
      aria-expanded={open}
      title={open ? "Close the to-do list" : "To-do list"}
      onClick={onToggle}
      className={`h-[30px] w-[30px] cursor-pointer rounded-full border bg-panel text-[13px] text-ink-dim transition-colors hover:border-accent hover:text-accent ${open ? "border-accent" : "border-edge"}`}
    >
      ☑
    </button>
  );
}
