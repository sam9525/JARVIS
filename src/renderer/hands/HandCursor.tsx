import React from "react";

type Props = { x: number; y: number; visible: boolean };

// The pointer the app has never had. It exists so a pinch can be hit-tested
// against panel title bars; it selects nothing and clicks nothing.
export default function HandCursor({ x, y, visible }: Props) {
  if (!visible) return null;
  return (
    <div
      data-testid="hand-cursor"
      className="pointer-events-none absolute z-[48] h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-soft"
      style={{
        left: x,
        top: y,
        boxShadow: "0 0 12px rgba(103,232,249,0.8)",
      }}
    />
  );
}
