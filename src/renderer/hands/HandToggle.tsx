import React from "react";

// The ✋ button and its states (design §3). The pulse means "hands are
// driving something", not "the camera is powered" — Cards registers no
// actions, and a pulse there would make a working feature look broken.
// Disarmed keeps the accent hue but goes dashed — the camera is still on, so
// it must not render as the camera-off state. Only the switch turns the
// camera off; a click while disarmed re-arms instead.
export default function HandToggle({
  cameraOn,
  armed,
  hasActions,
  error,
  onToggle,
  onRearm,
}: {
  cameraOn: boolean;
  armed: boolean;
  hasActions: boolean;
  error: string | null;
  onToggle(): void;
  onRearm(): void;
}) {
  const disarmed = cameraOn && !armed;
  const pulse = cameraOn && hasActions;
  const border = error
    ? "border-warm"
    : disarmed
      ? "border-dashed border-accent"
      : cameraOn
        ? "border-accent"
        : "border-edge";
  const title = error
    ? `Hand control: ${error}`
    : cameraOn && !hasActions
      ? "Hand control on — no gestures on this view"
      : cameraOn
        ? armed
          ? "Hand control on"
          : "Hand control disarmed (camera still on) — hold an open palm, or click, to re-arm"
        : "Hand control";
  return (
    <button
      data-testid="hand-toggle"
      title={title}
      // disarmed is a pause, not an off state — the click out of it re-arms
      onClick={disarmed ? onRearm : onToggle}
      className={`h-[30px] w-[30px] cursor-pointer rounded-full border bg-panel text-[13px] text-ink-dim transition-colors hover:border-accent hover:text-accent ${border}`}
    >
      <span
        data-testid="hand-glyph"
        className={pulse ? "animate-pulse" : undefined}
      >
        ✋
      </span>
    </button>
  );
}
