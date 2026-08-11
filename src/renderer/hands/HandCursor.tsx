import React, { forwardRef, useImperativeHandle, useRef } from "react";

export type HandCursorHandle = {
  setPosition(x: number, y: number): void;
};

type Props = {
  visible: boolean;
  initialX: number;
  initialY: number;
};

// The pointer the app has never had. It exists so a pinch can be hit-tested
// against panel title bars; it selects nothing and clicks nothing.
//
// Position arrives at tracker frame rate (~30Hz). Routing it through React
// state would reconcile the whole App tree on every frame, so the parent
// instead writes it straight to this node's style via the imperative
// handle — `initialX`/`initialY` only seed the very first paint (I8).
const HandCursor = forwardRef<HandCursorHandle, Props>(function HandCursor(
  { visible, initialX, initialY },
  ref,
) {
  const elRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      setPosition(x: number, y: number) {
        const el = elRef.current;
        if (el) {
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
        }
      },
    }),
    [],
  );

  if (!visible) return null;
  return (
    <div
      ref={elRef}
      data-testid="hand-cursor"
      className="pointer-events-none absolute z-[48] h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-soft"
      style={{
        left: initialX,
        top: initialY,
        boxShadow: "0 0 12px rgba(103,232,249,0.8)",
      }}
    />
  );
});

export default HandCursor;
