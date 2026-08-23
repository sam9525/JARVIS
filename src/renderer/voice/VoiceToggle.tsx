import React from "react";

// The 🎤 button, sized and styled to sit in the ✋/↻/⚙ row. Simpler than
// HandToggle on purpose: nothing disarms voice, so there is no dashed state.
// The pulse means "a dictation is open" — it holds between breaths, which is
// how you know a pause has not ended your sentence.
export default function VoiceToggle({
  micOn,
  capturing,
  error,
  onToggle,
}: {
  micOn: boolean;
  capturing: boolean;
  error: string | null;
  onToggle(): void;
}) {
  const border = error
    ? "border-warm"
    : micOn
      ? "border-accent"
      : "border-edge";
  const title = error
    ? `Voice: ${error}`
    : micOn
      ? 'Voice on — say "jarvis", then your prompt'
      : "Voice control";
  return (
    <button
      data-testid="voice-toggle"
      title={title}
      onClick={onToggle}
      className={`h-[30px] w-[30px] cursor-pointer rounded-full border bg-panel text-[13px] text-ink-dim transition-colors hover:border-accent hover:text-accent ${border}`}
    >
      <span
        data-testid="voice-glyph"
        className={capturing ? "animate-pulse" : undefined}
      >
        🎤
      </span>
    </button>
  );
}
