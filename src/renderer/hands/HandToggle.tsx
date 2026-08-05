import React from "react";

// The ✋ button and its states (design §3). The pulse means "hands are
// driving something", not "the camera is powered" — Cards registers no
// actions, and a pulse there would make a working feature look broken. The
// armed border renders only while the camera is on; losing it is the sole
// disarm signal — a disarmed state that shouts defeats disarming.
export default function HandToggle({
  cameraOn,
  armed,
  hasActions,
  error,
  onToggle,
}: {
  cameraOn: boolean;
  armed: boolean;
  hasActions: boolean;
  error: string | null;
  onToggle(): void;
}) {
  const pulse = cameraOn && hasActions;
  const border = error
    ? "border-warm"
    : cameraOn && armed
      ? "border-accent"
      : "border-edge";
  const title = error
    ? `Hand control: ${error}`
    : cameraOn && !hasActions
      ? "Hand control on — no gestures on this view"
      : cameraOn
        ? armed
          ? "Hand control on"
          : "Hand control disarmed — hold an open palm to re-arm"
        : "Hand control";
  return (
    <button
      data-testid="hand-toggle"
      title={title}
      onClick={onToggle}
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
