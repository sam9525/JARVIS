import React from "react";

// Off is the same circle as the ✋/🎤/↻/⚙ row; on widens into a filled pill so
// an answering session is never mistaken for an idle one.
export default function AutoAnswerToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle(): void;
}) {
  return (
    <button
      data-testid="auto-answer-toggle"
      aria-pressed={on}
      title={
        on
          ? "Auto-answer on: picks Approve or the Recommended option"
          : "Auto-answer off: questions wait for you"
      }
      onClick={onToggle}
      className={
        on
          ? "h-[30px] w-auto cursor-pointer rounded-full border border-accent bg-accent px-3 font-hud text-[11px] tracking-[0.12em] text-abyss transition-colors"
          : "h-[30px] w-[30px] cursor-pointer rounded-full border border-edge bg-panel text-[13px] text-ink-dim transition-colors hover:border-accent hover:text-accent"
      }
    >
      {on ? "AUTO ON" : "A"}
    </button>
  );
}
