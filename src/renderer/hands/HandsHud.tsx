import React, { useEffect, useState } from "react";
import type { HandDebug } from "./gestures";

// The gestures had no feedback at all: a gate that never opened looked
// identical to a camera that was off. This is the instrument — it reads the
// same `window.__hands` the engine already publishes, polled rather than
// pushed so a 30 fps tracker cannot re-render the app 30 times a second.
// Every number is next to the threshold it has to beat.
export default function HandsHud() {
  const [d, setD] = useState<HandDebug | null>(null);
  useEffect(() => {
    const id = setInterval(
      () =>
        setD((window as unknown as { __hands?: HandDebug }).__hands ?? null),
      150,
    );
    return () => clearInterval(id);
  }, []);
  if (!d) return null;
  const num = (n: number) => n.toFixed(2);
  return (
    <div
      data-testid="hands-hud"
      className="pointer-events-none fixed bottom-3 left-3 z-50 rounded border border-edge bg-panel/90 px-2 py-1 font-mono text-[10px] leading-tight text-ink-dim"
    >
      <div>{d.tracked ? `posture ${d.posture}` : "no hand"}</div>
      <div>
        pinch {num(d.pinch)} · roll {num(d.roll)} · swipe {num(d.swipe)} · tap{" "}
        {num(d.tap)}
      </div>
      {d.events.length > 0 && (
        <div className="text-accent">last {d.events.join(" ")}</div>
      )}
    </div>
  );
}
