import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

export type HandCursorHandle = {
  setPosition(x: number, y: number): void;
};

// long enough to ride out a dropped frame or two, short enough that a hand
// dropped out of view doesn't leave a dot hanging on screen
const IDLE_MS = 400;

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
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The engine publishes a cursor only on a *tracked* frame, so a hand leaving
  // the camera simply stops the updates and the dot would sit frozen at its
  // last position for as long as hands stay armed. Fade it out here rather than
  // in the parent: a "hand lost" React state would cost a render per frame to
  // keep resetting, which is the whole thing this handle exists to avoid.
  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      setPosition(x: number, y: number) {
        const el = elRef.current;
        if (!el) return;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.opacity = "1";
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => {
          idleTimer.current = null;
          if (elRef.current) elRef.current.style.opacity = "0";
        }, IDLE_MS);
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
        transition: "opacity 150ms linear",
      }}
    />
  );
});

export default HandCursor;
